// Build a standalone executable (Node single-executable application) so people
// without Node/npm can install the CLI. Builds for the platform it runs on:
//   node scripts/build-binary.mjs [outfile]
// Requires Node >= 22 (the node binary doing the build is the runtime embedded).
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const win = process.platform === 'win32';
const out = path.resolve(process.argv[2] ?? path.join(root, 'build', win ? 'wavespeed.exe' : 'wavespeed'));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-sea-'));

fs.mkdirSync(path.dirname(out), { recursive: true });

// 1. Bundle to one CommonJS file (SEA cannot load ESM or node_modules).
const bundle = path.join(work, 'cli.cjs');
await build({
  entryPoints: [path.join(root, 'src/cli.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  // Modules that use import.meta.url (e.g. `open`, `conf`) need a stand-in in CJS.
  banner: { js: "const __import_meta_url = require('node:url').pathToFileURL(__filename).href;" },
  define: {
    'import.meta.url': '__import_meta_url',
    __WS_VERSION__: JSON.stringify(pkg.version),
    __WS_SKILL__: JSON.stringify(fs.readFileSync(path.join(root, 'skills/SKILL.md'), 'utf8')),
  },
  logLevel: 'warning',
});

// 2. Turn the bundle into a SEA blob.
const blob = path.join(work, 'sea.blob');
const seaConfig = path.join(work, 'sea-config.json');
fs.writeFileSync(seaConfig, JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true }));
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

// 3. Copy the node binary and inject the blob.
fs.copyFileSync(process.execPath, out);
fs.chmodSync(out, 0o755);
if (process.platform === 'darwin') execFileSync('codesign', ['--remove-signature', out]);
const postject = path.join(root, 'node_modules', 'postject', 'dist', 'cli.js');
const args = [postject, out, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'];
if (process.platform === 'darwin') args.push('--macho-segment-name', 'NODE_SEA');
execFileSync(process.execPath, args, { stdio: 'inherit' });
if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', out]);

fs.rmSync(work, { recursive: true, force: true });
console.log(`built ${out} (v${pkg.version})`);
