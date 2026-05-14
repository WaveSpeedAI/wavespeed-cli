import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { confirm } from '@inquirer/prompts';
import { deletePredictions } from '../lib/api.js';

export function registerDelete(program: Command): void {
  program
    .command('delete')
    .description('Delete one or more predictions from your history')
    .argument('<id...>', 'Prediction ID(s) to delete')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .option('--json', 'Emit JSON: {deleted: [...ids]}')
    .action(async (ids: string[], opts: { yes?: boolean; json?: boolean }) => {
      if (!opts.yes && !opts.json) {
        const go = await confirm({
          message: `Delete ${ids.length} prediction${ids.length === 1 ? '' : 's'} from your history? This cannot be undone.`,
          default: false,
        });
        if (!go) {
          console.log(chalk.gray('Aborted.'));
          return;
        }
      }

      const spinner = !opts.json ? ora(`Deleting ${ids.length} prediction${ids.length === 1 ? '' : 's'}…`).start() : null;
      try {
        await deletePredictions(ids);
        spinner?.succeed(`Deleted ${ids.length} prediction${ids.length === 1 ? '' : 's'}.`);

        if (opts.json) {
          process.stdout.write(JSON.stringify({ deleted: ids }, null, 2) + '\n');
        }
      } catch (err: any) {
        spinner?.fail(err.message ?? String(err));
        if (opts.json) {
          process.stdout.write(JSON.stringify({ error: err.message ?? String(err) }, null, 2) + '\n');
        }
        process.exit(1);
      }
    });
}
