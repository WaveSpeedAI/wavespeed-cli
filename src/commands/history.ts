import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { fetchHistory, HistoryItem, PREDICTION_STATUSES } from '../lib/api.js';
import { toIso } from '../lib/time.js';

function statusBadge(status: string): string {
  const map: Record<string, (s: string) => string> = {
    completed: chalk.bgGreen.black,
    failed: chalk.bgRed.white,
    processing: chalk.bgYellow.black,
    pending: chalk.bgYellow.black,
    created: chalk.bgGray.white,
  };
  const fn = map[status] ?? chalk.bgGray.white;
  return fn(` ${status} `);
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  } catch {
    return iso;
  }
}

// A YYYY-MM-DD date `n` months back, for hints that must stay inside the
// API's search window.
function monthsAgo(n: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - n);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** True when --since reaches further back than the API's 3-month window. */
export function beyondWindow(since: string, until?: string): boolean {
  const end = until ? new Date(toIso(until, true)) : new Date();
  const oldest = new Date(end);
  oldest.setUTCMonth(oldest.getUTCMonth() - 3);
  return new Date(toIso(since)).getTime() < oldest.getTime();
}

function firstOutput(item: HistoryItem): string {
  const out = item.outputs?.[0];
  if (typeof out === 'string') return out;
  return '';
}

export function registerHistory(program: Command): void {
  program
    .command('history')
    .description('List your recent predictions (default: last 24h; the API keeps only the last 3 months searchable)')
    .option('--page <n>', 'Page number (the API serves at most page 100)', '1')
    .option('--limit <n>', 'Page size (1-100)', '20')
    .option('--model <id>', 'Filter by model ID')
    .option('--status <s>', 'Filter by status (created, processing, completed, failed, cancelled, timeout, deleted)')
    .option('--since <time>', 'Predictions created after this time (ISO or YYYY-MM-DD; at most 3 months before --until)')
    .option('--until <time>', 'Predictions created before this time (ISO or YYYY-MM-DD)')
    .option('--json', 'Emit JSON: {page, items: [...]}')
    .action(async (opts: any) => {
      if (opts.status && !PREDICTION_STATUSES.includes(opts.status)) {
        const msg = `Unknown status "${opts.status}". One of: ${PREDICTION_STATUSES.join(', ')}.`;
        if (opts.json) process.stdout.write(JSON.stringify({ error: msg }, null, 2) + '\n');
        else console.error(chalk.red('Error: ') + msg);
        process.exit(1);
      }
      const spinner = !opts.json ? ora('Fetching history…').start() : null;
      try {
        const data = await fetchHistory({
          page: parseInt(opts.page, 10),
          pageSize: parseInt(opts.limit, 10),
          model: opts.model,
          status: opts.status,
          createdAfter: opts.since ? toIso(opts.since) : undefined,
          createdBefore: opts.until ? toIso(opts.until, true) : undefined,
        });
        spinner?.stop();

        if (opts.json) {
          process.stdout.write(JSON.stringify(data, null, 2) + '\n');
          return;
        }
        if (opts.since && beyondWindow(opts.since, opts.until)) {
          console.error(
            chalk.yellow('Note: ') +
              chalk.gray('the API searches at most 3 months before --until (or now); earlier predictions are not listed.'),
          );
        }

        const items = data.items ?? [];
        console.log();
        console.log(
          chalk.bold(`${items.length} prediction${items.length === 1 ? '' : 's'}`) +
            chalk.gray(`  · page ${data.page}`) +
            // The silent 24h default made "where did yesterday's runs go?" a
            // recurring surprise; name the window whenever it applies.
            (opts.since || opts.until ? '' : chalk.gray('  · last 24h (widen with --since)')),
        );
        console.log();

        if (items.length === 0) {
          console.log(
            chalk.gray(
              `  no predictions in this range. Widen it with --since (e.g. --since ${monthsAgo(3)}); ` +
                'the API searches at most the 3 months before --until, earlier dates are ignored.',
            ),
          );
          console.log();
          return;
        }

        for (const item of items) {
          const promptText =
            (item.inputs?.prompt as string | undefined) ?? (item.input?.prompt as string | undefined) ?? '';
          const shortPrompt = promptText.replace(/\s+/g, ' ').trim().slice(0, 60);
          console.log(
            statusBadge(item.status) +
              '  ' +
              chalk.cyan(item.id) +
              '  ' +
              chalk.gray(formatTime(item.created_at)),
          );
          console.log('    ' + chalk.gray('model:  ') + chalk.white(item.model));
          if (shortPrompt) console.log('    ' + chalk.gray('prompt: ') + chalk.white(shortPrompt + (promptText.length > 60 ? '…' : '')));
          const out = firstOutput(item);
          if (out) console.log('    ' + chalk.gray('output: ') + chalk.cyan(out));
          if (item.error) console.log('    ' + chalk.gray('error:  ') + chalk.red(item.error));
          console.log();
        }

        console.log(
          chalk.gray('Details: ') + chalk.cyan('wavespeed show <id>') + chalk.gray('   delete: ') + chalk.cyan('wavespeed delete <id>'),
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
