import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import open from 'open';
import { fetchBalance } from '../lib/api.js';

const TOPUP_URL = 'https://wavespeed.ai/top-up';

export function registerBalance(program: Command): void {
  program
    .command('balance')
    .description('Show the credit balance on your Wavespeed account')
    .option('--json', 'Emit JSON: {balance, currency, top_up_url}')
    .option('--top-up', 'Open the top-up page in your browser after printing')
    .action(async (opts: { json?: boolean; topUp?: boolean }) => {
      const spinner = !opts.json ? ora('Checking balance…').start() : null;
      let balance: number;
      try {
        const data = await fetchBalance();
        balance = data.balance;
        spinner?.stop();
      } catch (err: any) {
        spinner?.fail(err.message ?? String(err));
        if (opts.json) {
          process.stdout.write(JSON.stringify({ error: err.message ?? String(err) }, null, 2) + '\n');
        }
        process.exit(1);
      }

      if (opts.json) {
        process.stdout.write(
          JSON.stringify({ balance, currency: 'USD', top_up_url: TOPUP_URL }, null, 2) + '\n',
        );
        return;
      }

      const display = balance.toFixed(balance < 10 ? 3 : 2);
      console.log();
      console.log(chalk.bold('Balance: ') + chalk.green(`$${display}`));
      console.log(chalk.gray('Top up:  ') + chalk.cyan(TOPUP_URL));
      console.log();

      if (opts.topUp) {
        await open(TOPUP_URL).catch(() => {
          /* opening failed — the URL is already in the output */
        });
      }
    });
}
