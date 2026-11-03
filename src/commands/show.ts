import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { fetchPrediction, inferenceMs, unavailableReason } from '../lib/api.js';
import { downloadOutputs, printOutputs } from '../lib/output.js';
import { downloadOptsFromFlag } from '../lib/download-flag.js';

function formatTime(iso: string): string {
  try {
    return new Date(iso).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  } catch {
    return iso;
  }
}

export function registerShow(program: Command): void {
  program
    .command('show')
    .description('Show full details for a past prediction')
    .argument('<id>', 'Prediction ID (from `wavespeed history` or a previous `run --json` response)')
    .option('--download [path]', 'Save outputs locally (optional path template, e.g. "./out/{index}.{ext}")')
    .option('--output-dir <dir>', 'Directory for --download when no path is given')
    .option('--json', 'Emit the raw prediction record as JSON')
    .action(async (id: string, opts: any) => {
      const spinner = !opts.json ? ora(`Fetching ${id}…`).start() : null;
      try {
        const item = await fetchPrediction(id);
        spinner?.stop();

        const urls: string[] = Array.isArray(item.outputs)
          ? item.outputs.filter((o): o is string => typeof o === 'string')
          : [];

        let saved: string[] = [];
        const dlOpts = downloadOptsFromFlag(opts.download, {
          model: item.model,
          prompt:
            typeof item.inputs?.prompt === 'string'
              ? (item.inputs.prompt as string)
              : typeof item.input?.prompt === 'string'
                ? (item.input.prompt as string)
                : undefined,
          outputDir: opts.outputDir,
        });
        if (urls.length > 0 && dlOpts) {
          const dl = !opts.json ? ora('Downloading…').start() : null;
          saved = await downloadOutputs(urls, dlOpts);
          dl?.succeed(`Saved ${saved.length} file${saved.length > 1 ? 's' : ''}.`);
        }

        if (opts.json) {
          process.stdout.write(JSON.stringify({ ...item, saved }, null, 2) + '\n');
          return;
        }

        console.log();
        console.log(chalk.bold('▶ ') + chalk.cyan(item.id || id));
        console.log('  ' + chalk.gray('model:    ') + chalk.white(item.model || '-'));
        console.log('  ' + chalk.gray('status:   ') + chalk.white(item.status || 'unavailable'));
        if (item.created_at) console.log('  ' + chalk.gray('created:  ') + chalk.white(formatTime(item.created_at)));
        const elapsed = inferenceMs(item);
        if (elapsed !== undefined) console.log('  ' + chalk.gray('elapsed:  ') + chalk.white(`${elapsed}ms`));
        const promptText =
          (item.inputs?.prompt as string | undefined) ??
          (item.input?.prompt as string | undefined);
        if (promptText) console.log('  ' + chalk.gray('prompt:   ') + chalk.white(promptText));
        // Archived records come back with no outputs (and, from older API
        // versions, no status): say so instead of an unexplained blank.
        const unavailable = unavailableReason(item);
        if (item.error) console.log('  ' + chalk.gray('error:    ') + chalk.red(item.error));
        else if (unavailable) console.log('  ' + chalk.gray('note:     ') + chalk.yellow(unavailable));

        if (urls.length > 0) printOutputs(saved, urls);
        else console.log('\n  ' + chalk.gray('(no outputs)') + '\n');
      } catch (err: any) {
        spinner?.fail(err.message ?? String(err));
        if (opts.json) {
          process.stdout.write(JSON.stringify({ error: err.message ?? String(err) }, null, 2) + '\n');
        }
        process.exit(1);
      }
    });
}
