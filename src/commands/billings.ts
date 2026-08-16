import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { fetchBillings, BillingItem } from '../lib/api.js';
import { toIso } from '../lib/time.js';

function money(v: number | undefined): string {
  if (v === undefined) return '';
  return `$${v.toFixed(4)}`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  } catch {
    return iso;
  }
}

export function registerBillings(program: Command): void {
  program
    .command('billings')
    .description('List itemized charges and refunds (billing records)')
    .option('--page <n>', 'Page number', '1')
    .option('--limit <n>', 'Page size (1-100)', '20')
    .option('--type <t>', 'Filter by type: deduct or refund')
    .option('--model <uuid>', 'Filter by model')
    .option('--key <uuid>', 'Filter by the API key that generated the charge')
    .option('--since <time>', 'Records after this time (ISO or YYYY-MM-DD)')
    .option('--until <time>', 'Records before this time (ISO or YYYY-MM-DD)')
    .option('--json', 'Emit JSON: {page, has_more, items}')
    .action(async (opts: any) => {
      const spinner = !opts.json ? ora('Fetching billing records…').start() : null;
      try {
        const data = await fetchBillings({
          page: parseInt(opts.page, 10),
          pageSize: parseInt(opts.limit, 10),
          type: opts.type,
          model: opts.model,
          accessKey: opts.key,
          startTime: opts.since ? toIso(opts.since) : undefined,
          endTime: opts.until ? toIso(opts.until, true) : undefined,
        });
        spinner?.stop();

        if (opts.json) {
          process.stdout.write(JSON.stringify(data, null, 2) + '\n');
          return;
        }

        const items: BillingItem[] = data.items ?? [];
        console.log();
        console.log(
          chalk.bold(`${items.length} record${items.length === 1 ? '' : 's'}`) +
            chalk.gray(`  · page ${data.page}${data.has_more ? '  · more available (--page)' : ''}`),
        );
        console.log();

        if (items.length === 0) {
          console.log(chalk.gray('  no billing records in this range.'));
          console.log();
          return;
        }

        let pageTotal = 0;
        for (const b of items) {
          const sign = b.billing_type === 'refund' ? chalk.green('+') : chalk.red('-');
          pageTotal += (b.billing_type === 'refund' ? 1 : -1) * b.price;
          const model = b.prediction?.model_uuid ?? '';
          console.log(
            `  ${sign}${money(b.price).padEnd(10)} ${chalk.gray(formatTime(b.created_at))}  ` +
              chalk.white(model.padEnd(40)) +
              (b.access_key_name ? chalk.gray(` key:${b.access_key_name}`) : ''),
          );
          if (b.prediction?.uuid) {
            console.log('      ' + chalk.gray('prediction: ') + chalk.cyan(b.prediction.uuid));
          }
        }
        console.log();
        console.log(
          chalk.gray('  page net: ') +
            (pageTotal < 0 ? chalk.red(`-$${Math.abs(pageTotal).toFixed(4)}`) : chalk.green(`+$${pageTotal.toFixed(4)}`)),
        );
        console.log();
      } catch (err: any) {
        spinner?.fail(err.message ?? String(err));
        if (opts.json) {
          process.stdout.write(JSON.stringify({ error: err.message ?? String(err) }, null, 2) + '\n');
        }
        process.exit(1);
      }
    });
}
