import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { fetchUsageStats } from '../lib/api.js';

/** Accepts ISO or YYYY-MM-DD; returns full RFC3339 the API requires. */
function toIso(value: string, endOfDay = false): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value + (endOfDay ? 'T23:59:59Z' : 'T00:00:00Z');
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) throw new Error(`Invalid time "${value}". Use ISO 8601 or YYYY-MM-DD.`);
  return d.toISOString();
}

export function registerUsage(program: Command): void {
  program
    .command('usage')
    .description('Usage statistics: spend, request counts, per-model breakdown (default: last 7 days)')
    .option('--since <time>', 'Start of the window (ISO or YYYY-MM-DD)')
    .option('--until <time>', 'End of the window (ISO or YYYY-MM-DD)')
    .option('--model <uuid>', 'Restrict to one model')
    .option('--json', 'Emit the raw stats as JSON')
    .action(async (opts: any) => {
      const spinner = !opts.json ? ora('Fetching usage…').start() : null;
      try {
        const now = new Date();
        const start = opts.since
          ? toIso(opts.since)
          : new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
        const end = opts.until ? toIso(opts.until, true) : now.toISOString();

        const stats = await fetchUsageStats(start, end, opts.model);
        spinner?.stop();

        if (opts.json) {
          process.stdout.write(JSON.stringify(stats, null, 2) + '\n');
          return;
        }

        const s = stats.summary;
        const failed = s.total_requests - s.success_requests;
        console.log();
        console.log(
          chalk.bold('Usage ') +
            chalk.gray(`${start.slice(0, 10)} → ${end.slice(0, 10)}`) +
            (opts.since || opts.until ? '' : chalk.gray('  · last 7d (widen with --since)')),
        );
        console.log();
        console.log('  ' + chalk.gray('total spend:   ') + chalk.green(`$${s.total_cost.toFixed(4)}`));
        console.log(
          '  ' +
            chalk.gray('requests:      ') +
            chalk.white(`${s.total_requests}`) +
            chalk.gray(`  (${s.success_requests} ok, ${failed} failed)`),
        );
        console.log();

        const models = [...(stats.per_model_usage ?? [])].sort((a, b) => b.total_cost - a.total_cost);
        if (models.length > 0) {
          console.log(chalk.bold('  By model'));
          for (const m of models.slice(0, 15)) {
            console.log(
              '    ' +
                chalk.cyan(m.model_uuid.padEnd(44)) +
                chalk.green(`$${m.total_cost.toFixed(4)}`.padStart(10)) +
                (m.total_count ? chalk.gray(`  ×${m.total_count}`) : ''),
            );
          }
          if (models.length > 15) console.log(chalk.gray(`    … ${models.length - 15} more (use --json)`));
          console.log();
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
