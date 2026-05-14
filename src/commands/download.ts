import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { resolveOutputDir } from '../lib/config.js';
import { downloadOutputs } from '../lib/output.js';

async function downloadOne(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(dest));
}

export function registerDownload(program: Command): void {
  program
    .command('download')
    .description('Download one or more remote URLs to your output directory')
    .argument('<url...>', 'Remote URL(s) to fetch')
    .option('-o, --output <path>', 'Write to this exact path (only valid with a single URL)')
    .option('--output-dir <dir>', 'Directory to save into (default: wavespeed-output/)')
    .option('--json', 'Emit a single JSON object on stdout')
    .action(async (urls: string[], opts: { output?: string; outputDir?: string; json?: boolean }) => {
      if (opts.output && urls.length > 1) {
        const msg = '`-o/--output` only works with a single URL. Use `--output-dir` for batches.';
        if (opts.json) process.stdout.write(JSON.stringify({ error: msg }, null, 2) + '\n');
        else console.error(chalk.red(msg));
        process.exit(1);
      }

      let saved: string[] = [];

      if (opts.output) {
        const spinner = !opts.json ? ora(`Downloading ${urls[0]}…`).start() : null;
        try {
          const dest = path.resolve(opts.output);
          await downloadOne(urls[0], dest);
          saved = [dest];
          spinner?.succeed(`Saved ${path.relative(process.cwd(), dest)}`);
        } catch (err: any) {
          spinner?.fail(err.message ?? String(err));
          if (opts.json) process.stdout.write(JSON.stringify({ error: err.message ?? String(err) }, null, 2) + '\n');
          process.exit(1);
        }
      } else {
        const dir = opts.outputDir || resolveOutputDir();
        const spinner = !opts.json ? ora(`Downloading ${urls.length} file${urls.length > 1 ? 's' : ''}…`).start() : null;
        try {
          saved = await downloadOutputs(urls, { outputDir: dir });
          spinner?.succeed(`Saved ${saved.length} file${saved.length > 1 ? 's' : ''}.`);
        } catch (err: any) {
          spinner?.fail(err.message ?? String(err));
          if (opts.json) process.stdout.write(JSON.stringify({ error: err.message ?? String(err) }, null, 2) + '\n');
          process.exit(1);
        }
      }

      if (opts.json) {
        process.stdout.write(JSON.stringify({ outputs: urls, saved }, null, 2) + '\n');
        return;
      }
      console.log();
      for (const f of saved) console.log('  ' + chalk.cyan(path.relative(process.cwd(), f)));
      console.log();
    });
}
