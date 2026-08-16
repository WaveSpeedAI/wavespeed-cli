import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'node:fs';
import { requireClient } from '../lib/client.js';
import { uploadWithCache } from '../lib/upload-cache.js';

export function registerUpload(program: Command): void {
  program
    .command('upload')
    .description('Upload one or more local files to Wavespeed and print their CDN URLs')
    .argument('<file...>', 'Path(s) to file(s)')
    .option('--json', 'Emit a JSON object on stdout')
    .action(async (files: string[], opts: { json?: boolean }) => {
      for (const f of files) {
        if (!fs.existsSync(f)) {
          const msg = `File not found: ${f}`;
          if (opts.json) process.stdout.write(JSON.stringify({ error: msg }, null, 2) + '\n');
          else console.error(chalk.red(msg));
          process.exit(1);
        }
      }

      const client = requireClient();
      const urls: string[] = [];
      const errors: Array<{ file: string; error: string }> = [];

      for (const file of files) {
        const spinner = !opts.json ? ora(`Uploading ${file}…`).start() : null;
        try {
          const { url, cached } = await uploadWithCache(file, (f) => client.upload(f));
          urls.push(url);
          spinner?.succeed(`${file} → ${url}` + (cached ? ' (cached)' : ''));
        } catch (err: any) {
          const message = err.message ?? String(err);
          errors.push({ file, error: message });
          spinner?.fail(`${file}: ${message}`);
        }
      }

      if (opts.json) {
        process.stdout.write(
          JSON.stringify(
            files.length === 1 && urls.length === 1 && errors.length === 0
              ? { url: urls[0] }
              : { urls, errors },
            null,
            2,
          ) + '\n',
        );
      } else if (!opts.json && files.length === 1 && urls.length === 1) {
        console.log();
        console.log(chalk.cyan(urls[0]));
        console.log();
      }

      if (errors.length > 0) process.exit(1);
    });
}
