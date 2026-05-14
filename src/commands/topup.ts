import { Command } from 'commander';
import chalk from 'chalk';
import open from 'open';

const TOPUP_URL = 'https://wavespeed.ai/top-up';

export function registerTopUp(program: Command): void {
  program
    .command('top-up')
    .description('Open the Wavespeed top-up page in your browser')
    .option('--print', 'Just print the URL, do not open the browser')
    .action(async (opts: { print?: boolean }) => {
      console.log();
      console.log(chalk.bold('Top up: ') + chalk.cyan(TOPUP_URL));
      console.log();
      if (opts.print) return;
      try {
        await open(TOPUP_URL);
      } catch {
        /* browser launch failed; the URL is printed above */
      }
    });
}
