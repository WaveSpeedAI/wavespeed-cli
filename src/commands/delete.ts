import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { confirm } from '@inquirer/prompts';
import { deletePredictions, DeleteResult } from '../lib/api.js';

export function registerDelete(program: Command): void {
  program
    .command('delete')
    .description('Delete one or more predictions from your history')
    .argument('<id...>', 'Prediction ID(s) to delete')
    .option('-y, --yes', 'Skip the confirmation prompt (required in scripts / non-interactive use)')
    .option('--json', 'Emit JSON: {deleted_ids, deleted_count, not_deleted_ids} (deleted = deleted_ids)')
    .action(async (ids: string[], opts: { yes?: boolean; json?: boolean }) => {
      // --json controls output format only; it must never stand in for
      // consent. Interactive terminals get the prompt, scripts must say -y.
      if (!opts.yes) {
        if (!process.stdin.isTTY) {
          const msg = 'Refusing to delete without confirmation. Pass --yes in non-interactive use.';
          if (opts.json) process.stdout.write(JSON.stringify({ error: msg }, null, 2) + '\n');
          else console.error(chalk.red(msg));
          process.exit(1);
        }
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
      // The server deletes only this organization's predictions that are not
      // running, so report what it actually deleted, not what was asked.
      const report = (r: DeleteResult) => {
        const n = r.deleted_ids.length;
        if (r.not_deleted_ids.length === 0) spinner?.succeed(`Deleted ${n} prediction${n === 1 ? '' : 's'}.`);
        else if (n > 0) spinner?.warn(`Deleted ${n} of ${n + r.not_deleted_ids.length} predictions.`);
        else spinner?.fail('No predictions were deleted.');
        if (!opts.json && r.not_deleted_ids.length > 0) {
          console.log(chalk.gray('  Not deleted (not found in this organization, still running, or already deleted):'));
          for (const id of r.not_deleted_ids) console.log('    ' + chalk.yellow(id));
        }
      };
      const payload = (r: DeleteResult) => ({
        // `deleted` is the pre-0.4.26 key, now also the server's deleted ids.
        deleted: r.deleted_ids,
        deleted_ids: r.deleted_ids,
        deleted_count: r.deleted_ids.length,
        not_deleted_ids: r.not_deleted_ids,
      });
      try {
        const result = await deletePredictions(ids);
        report(result);
        if (opts.json) process.stdout.write(JSON.stringify(payload(result), null, 2) + '\n');
        if (result.deleted_ids.length === 0) process.exit(1);
      } catch (err: any) {
        const message = err.message ?? String(err);
        const partial: DeleteResult | undefined = err.partial;
        spinner?.fail(message);
        if (!opts.json && partial && partial.deleted_ids.length > 0) {
          console.log(chalk.gray(`  ${partial.deleted_ids.length} deleted before the error; the remaining ${partial.not_deleted_ids.length} were not.`));
        }
        if (opts.json) {
          process.stdout.write(JSON.stringify({ error: message, ...(partial ? payload(partial) : {}) }, null, 2) + '\n');
        }
        process.exit(1);
      }
    });
}
