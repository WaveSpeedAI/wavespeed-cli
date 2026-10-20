import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { IS_STANDALONE, PACKAGE_NAME, VERSION, assetName, isNewer } from '../lib/version.js';
import { emitJson, emitJsonError, info, setJsonMode } from '../lib/log.js';

const REGISTRY_URL = `https://registry.npmjs.org/${encodeURIComponent(PACKAGE_NAME)}/latest`;

const RELEASES_URL = 'https://github.com/WaveSpeedAI/wavespeed-cli/releases';

// The standalone executable is distributed through GitHub Releases (the npm
// publish workflow creates the release right after publishing).
async function fetchLatestReleaseVersion(): Promise<string> {
  const res = await fetch('https://api.github.com/repos/WaveSpeedAI/wavespeed-cli/releases/latest', {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'wavespeed-cli' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`GitHub releases returned HTTP ${res.status}`);
  const tag = ((await res.json()) as { tag_name?: string }).tag_name;
  if (!tag) throw new Error('GitHub release response had no tag');
  return tag.replace(/^v/, '');
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(300_000), redirect: 'follow' });
  if (!res.ok) throw new Error(`download of ${url} failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// process.execPath may be a symlink (e.g. /usr/local/bin/wavespeed -> Cellar/...); act on the real file.
function realExecPath(): string {
  try { return fs.realpathSync(process.execPath); } catch { return process.execPath; }
}

/** Replace the running executable with the release asset, after checking its SHA-256. */
async function replaceExecutable(version: string): Promise<void> {
  const asset = assetName();
  const base = `${RELEASES_URL}/download/v${version}`;
  const [bin, sums] = await Promise.all([download(`${base}/${asset}`), download(`${base}/SHA256SUMS`)]);
  const expected = sums
    .toString('utf8')
    .split('\n')
    .map((l) => l.trim().split(/\s+/))
    .find((p) => p[1]?.replace(/^\*/, '') === asset)?.[0];
  const actual = crypto.createHash('sha256').update(bin).digest('hex');
  if (!expected || expected.toLowerCase() !== actual) throw new Error(`checksum mismatch for ${asset}; not installing`);

  const exe = realExecPath();
  const next = `${exe}.new`;
  fs.writeFileSync(next, bin, { mode: 0o755 });
  if (process.platform === 'win32') {
    // A running .exe cannot be overwritten but can be renamed out of the way.
    const old = `${exe}.old`;
    fs.rmSync(old, { force: true });
    fs.renameSync(exe, old);
  }
  fs.renameSync(next, exe);
}

export async function fetchLatestVersion(): Promise<string> {
  if (IS_STANDALONE) return fetchLatestReleaseVersion();
  const res = await fetch(REGISTRY_URL, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`npm registry returned HTTP ${res.status}`);
  const body = (await res.json()) as { version?: string };
  if (!body.version) throw new Error('npm registry response had no version');
  return body.version;
}

function runNpmInstall(): Promise<number> {
  return new Promise((resolve, reject) => {
    // Child output goes to stderr so `--json` keeps stdout clean.
    const child = spawn('npm', ['install', '-g', `${PACKAGE_NAME}@latest`], {
      stdio: ['ignore', 2, 2],
      shell: process.platform === 'win32', // npm is npm.cmd on Windows
    });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

/** Skill files written by `wavespeed skill install` are a snapshot; flag the ones in this directory. */
function installedSkillRoots(cwd: string = process.cwd()): string[] {
  return ['.claude', '.agents']
    .map((root) => path.join(root, 'skills', 'wavespeed', 'SKILL.md'))
    .filter((rel) => fs.existsSync(path.join(cwd, rel)));
}

/**
 * Other `wavespeed` executables on PATH besides the one running (e.g. an npm
 * install shadowing a standalone one). Upgrading one of them while the other
 * wins on PATH makes the upgrade look like it did nothing.
 */
export function otherInstalls(pathEnv: string = process.env.PATH ?? '', self: string = process.argv[1] ?? ''): string[] {
  const names = process.platform === 'win32' ? ['wavespeed.exe', 'wavespeed.cmd', 'wavespeed.ps1'] : ['wavespeed'];
  const real = (p: string) => { try { return fs.realpathSync(p); } catch { return null; } };
  const mine = new Set([real(process.execPath), real(self)].filter(Boolean) as string[]);
  const seen = new Set<string>();
  const found: string[] = [];
  for (const dir of pathEnv.split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const full = path.join(dir, name);
      const r = real(full);
      if (!r || seen.has(r)) continue;
      seen.add(r);
      // The npm shim and the package entry both count as "this" install.
      if (!mine.has(r) && !(!IS_STANDALONE && r.includes(`${path.sep}@wavespeed${path.sep}cli${path.sep}`))) found.push(full);
    }
  }
  return found;
}

function warnOtherInstalls(json: boolean | undefined): string[] {
  const others = otherInstalls();
  if (others.length && !json) {
    info(chalk.yellow('Note: another wavespeed is also on your PATH, so the version you run may not be the one just upgraded:'));
    for (const o of others) info(chalk.gray('  ' + o.replace(os.homedir(), '~')));
  }
  return others;
}

export function registerUpgrade(program: Command): void {
  program
    .command('upgrade')
    .alias('update')
    .description('Upgrade the CLI to the latest published version')
    .option('--check', 'Only report whether a newer version exists; do not install')
    .option('--json', 'Emit JSON: {current, latest, update_available, upgraded}')
    .action(async (opts: { check?: boolean; json?: boolean }) => {
      setJsonMode(!!opts.json);
      const fail = (message: string): never => {
        if (opts.json) emitJsonError(message, { current: VERSION });
        else console.error(chalk.red('Error: ') + message);
        process.exit(1);
      };

      let latest: string;
      try {
        latest = await fetchLatestVersion();
      } catch (err: any) {
        return fail(`Could not check for updates: ${err.message ?? String(err)}`);
      }

      const updateAvailable = isNewer(latest, VERSION);
      let others: string[] = [];
      if (!updateAvailable || opts.check) {
        if (opts.json) {
          emitJson({ current: VERSION, latest, update_available: updateAvailable, upgraded: false, other_installs: otherInstalls() });
        } else if (!updateAvailable) {
          info(chalk.green(`Already up to date (v${VERSION}).`));
          warnOtherInstalls(opts.json);
        } else {
          info(`Update available: v${VERSION} → ${chalk.bold('v' + latest)}. Run ${chalk.cyan('wavespeed upgrade')}.`);
        }
        return;
      }

      info(chalk.gray(`Upgrading v${VERSION} → v${latest}…`));
      if (IS_STANDALONE) {
        // Installed by a package manager: let it own the upgrade.
        const managed = /[\\/](Cellar|homebrew|Homebrew|WinGet|scoop)[\\/]/.exec(realExecPath());
        if (managed) {
          return fail(`This copy is managed by ${managed[1]}; upgrade it with your package manager (e.g. brew upgrade wavespeed).`);
        }
        try {
          await replaceExecutable(latest);
        } catch (err: any) {
          return fail(`Could not replace ${realExecPath()}: ${err.message ?? String(err)}`);
        }
      } else {
        let code: number;
        try {
          code = await runNpmInstall();
        } catch (err: any) {
          return fail(`Could not run npm: ${err.message ?? String(err)}`);
        }
        if (code !== 0) {
          return fail(
            `npm install -g exited with code ${code}. If it is a permissions error, fix npm's prefix or re-run with sudo: npm install -g ${PACKAGE_NAME}@latest`,
          );
        }
      }

      others = warnOtherInstalls(opts.json);
      const skills = installedSkillRoots();
      if (opts.json) {
        emitJson({ current: VERSION, latest, update_available: true, upgraded: true, stale_skill_files: skills, other_installs: others });
        return;
      }
      info(chalk.green(`Upgraded to v${latest}.`));
      if (skills.length) {
        info(chalk.gray('  Skill files here are from the old version: ') + chalk.cyan('wavespeed skill install') + chalk.gray(' to refresh.'));
      }
    });
}
