import { Command } from 'commander';
import { password, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import open from 'open';
import ora from 'ora';
import clipboard from 'clipboardy';
import { userConfig, getBaseUrl, getApiKey, loadProjectConfig, PROJECT_FILE } from '../lib/config.js';
import { LINKS } from '../lib/links.js';

const KEY_URL = 'https://wavespeed.ai/accesskey';

function mask(key: string): string {
  if (key.length < 12) return '••••';
  return key.slice(0, 5) + '…' + key.slice(-4);
}

function looksLikeKey(s: string | undefined | null): boolean {
  if (!s) return false;
  const t = s.trim();
  // WaveSpeed access keys are long hex strings (~64 chars). Be liberal:
  // any 40+ char single-line token of [a-zA-Z0-9_-] counts.
  return /^[A-Za-z0-9_-]{40,}$/.test(t);
}

async function readClipboardKey(): Promise<string | null> {
  try {
    const value = await clipboard.read();
    if (looksLikeKey(value)) return value.trim();
  } catch {
    /* no clipboard access — that's fine */
  }
  return null;
}

async function validateKey(
  apiKey: string,
  baseUrl: string,
): Promise<{ ok: boolean; status?: number; reason?: string }> {
  // The platform doesn't expose a dedicated /whoami yet, so we ping a known
  // authenticated endpoint and treat anything that isn't 401/403 as "key works".
  // Note this proves the key is live, not that it can run models: /balance is
  // deliberately open to every key regardless of the creator's org role, so a
  // Billing-created key logs in here and only fails at `run`, which now
  // surfaces the API's explanation of why.
  let res: Response | null = null;
  try {
    res = await fetch(`${baseUrl}/api/v3/balance`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (err: any) {
    return { ok: false, reason: `Could not reach ${baseUrl}: ${err.message}` };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: res.status, reason: 'API rejected the key (401/403).' };
  }
  return { ok: true, status: res.status };
}

async function loginFlow(opts: { apiKey?: string; browser: boolean }): Promise<void> {
  console.log();
  console.log(chalk.hex('#7c5cff').bold('  Welcome to WaveSpeed.'));
  console.log(chalk.gray('  Sign in once and you\'re set on this machine.\n'));

  let apiKey = opts.apiKey?.trim();

  if (!apiKey && opts.browser) {
    console.log(chalk.bold('  1.') + ' Opening ' + chalk.cyan(KEY_URL) + chalk.gray(' (sign in if needed)'));
    try {
      await open(KEY_URL);
    } catch {
      console.log(chalk.gray('     (browser launch failed — open the link manually)'));
    }
    console.log(chalk.bold('  2.') + ' Click ' + chalk.bold('Create key') + chalk.gray(' and copy it'));
    console.log(chalk.bold('  3.') + ' Paste below — we\'ll detect & validate it for you');
    console.log();
  }

  // Try clipboard first — major UX win.
  let detected: string | null = null;
  if (!apiKey) {
    detected = await readClipboardKey();
  }

  if (!apiKey && detected) {
    const useIt = await confirm({
      message: `Detected a key on your clipboard (${mask(detected)}). Use it?`,
      default: true,
    });
    if (useIt) apiKey = detected;
  }

  if (!apiKey) {
    apiKey = await password({
      message: 'Paste your API key:',
      mask: '*',
      validate: (v) => (v.trim().length > 8 ? true : 'API key looks too short.'),
    });
    apiKey = apiKey.trim();
  }

  const spinner = ora({ text: 'Validating with api.wavespeed.ai…', color: 'magenta' }).start();
  const result = await validateKey(apiKey, getBaseUrl());
  if (!result.ok) {
    spinner.fail(result.reason ?? 'The key did not authenticate.');
    console.log();
    console.log(chalk.gray('  Double-check at ') + chalk.cyan(KEY_URL));
    console.log(chalk.gray('  Or set ') + chalk.cyan('WAVESPEED_API_KEY') + chalk.gray(' in your shell and skip login altogether.'));
    console.log();
    process.exit(1);
  }
  spinner.succeed('Signed in.');

  userConfig.set('apiKey', apiKey);

  console.log();
  console.log('  ' + chalk.gray('Key:    ') + chalk.green(mask(apiKey)));
  console.log('  ' + chalk.gray('Stored: ') + chalk.cyan(userConfig.path));

  console.log();
  console.log(chalk.bold('Try it:'));
  console.log('  ' + chalk.cyan('wavespeed models                       # browse the catalog'));
  console.log('  ' + chalk.cyan('wavespeed run wavespeed-ai/z-image/turbo -p "a cyberpunk skyline at golden hour"'));
  console.log('  ' + chalk.cyan('wavespeed run bytedance/seedance-2.5/text-to-video -p "drone shot over snowy peaks"'));
  console.log();
}

export function registerAuth(program: Command): void {
  program
    .command('login')
    .description('Sign in to Wavespeed on this machine (browser + paste-key wizard)')
    .option('--api-key <key>', 'Pre-fill the API key (skips the prompt)')
    .option('--no-browser', 'Skip opening the access-key page in a browser')
    .action(async (opts: { apiKey?: string; browser: boolean }) => {
      await loginFlow(opts);
    });

  program
    .command('logout')
    .description('Clear the stored API key')
    .action(() => {
      userConfig.delete('apiKey');
      console.log(chalk.green('Signed out.'));
    });

  program
    .command('status')
    .description('Show the active account, base URL, and where the key is stored')
    .action(() => {
      const key = getApiKey();
      const baseUrl = getBaseUrl();
      console.log();
      console.log(chalk.bold('WaveSpeed CLI status'));
      console.log('  ' + chalk.gray('API key:    ') + (key ? chalk.green(mask(key)) : chalk.red('not set — run `wavespeed login`')));
      console.log('  ' + chalk.gray('Base URL:   ') + chalk.cyan(baseUrl));
      console.log('  ' + chalk.gray('Config:     ') + chalk.cyan(userConfig.path));
      console.log(
        '  ' +
          chalk.gray('Source:     ') +
          (process.env.WAVESPEED_API_KEY
            ? chalk.yellow('WAVESPEED_API_KEY env var (overrides stored config)')
            : chalk.gray('stored config')),
      );
      const project = loadProjectConfig();
      if (project) {
        console.log('  ' + chalk.gray('Project:    ') + chalk.cyan(PROJECT_FILE) + chalk.gray(' detected'));
      }
      console.log();
      console.log(chalk.bold('Useful links'));
      const width = Math.max(...Object.keys(LINKS).map((k) => k.length));
      for (const [name, link] of Object.entries(LINKS)) {
        console.log('  ' + chalk.gray(name.padEnd(width)) + '  ' + chalk.cyan(link.url));
      }
      console.log();
      console.log(chalk.gray('Jump in your browser: ') + chalk.cyan('wavespeed open <target>'));
      console.log();
    });

  program
    .command('config')
    .description('View or change CLI defaults (base URL, default model, output dir)')
    .option('--base-url <url>', 'Override API base URL')
    .option('--default-model <id>', 'Default model used by `wavespeed run` when no model is given')
    .option('--output-dir <dir>', 'Where to save outputs when --download has no path')
    .option('--reset', 'Reset all CLI config to defaults')
    .action((opts: any) => {
      if (opts.reset) {
        userConfig.clear();
        console.log(chalk.green('Config reset.'));
        return;
      }
      if (opts.baseUrl) userConfig.set('baseUrl', opts.baseUrl);
      if (opts.defaultModel) userConfig.set('defaultModel', opts.defaultModel);
      if (opts.outputDir) userConfig.set('outputDir', opts.outputDir);
      const store = userConfig.store;
      console.log();
      console.log(chalk.bold('Stored config:'));
      for (const [k, v] of Object.entries(store)) {
        const printed = k === 'apiKey' && typeof v === 'string' ? mask(v) : JSON.stringify(v);
        console.log('  ' + chalk.gray(k.padEnd(22)) + chalk.cyan(printed));
      }
      console.log();
    });
}
