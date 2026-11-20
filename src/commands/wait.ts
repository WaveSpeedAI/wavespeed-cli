import { Command } from 'commander';
import ora from 'ora';
import { fetchPredictionWithRetry, isInProgress, type HistoryItem } from '../lib/api.js';
import { renderPrediction } from './show.js';

// Exit codes: 0 completed with outputs, 1 ended without a result (failed,
// cancelled, expired, or the status could not be read), 2 still running when
// --timeout ran out. A coding agent can run `wavespeed wait <id>` in the
// background and is told when the run ends, instead of polling `show`.
export const WAIT_EXIT = { completed: 0, failed: 1, stillRunning: 2 } as const;

export function parseSeconds(value: string | undefined, name: string, fallback?: number): number | undefined {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number of seconds, got "${value}"`);
  return n;
}

export function waitExitCode(item: HistoryItem, done: boolean): number {
  if (!done) return WAIT_EXIT.stillRunning;
  const hasOutputs = Array.isArray(item.outputs) && item.outputs.length > 0;
  return item.status === 'completed' && hasOutputs ? WAIT_EXIT.completed : WAIT_EXIT.failed;
}

export function registerWait(program: Command): void {
  program
    .command('wait')
    .description('Wait for a prediction to finish, then show it (exit 0 completed, 1 failed, 2 still running at --timeout)')
    .argument('<id>', 'Prediction ID (from `run --json`, `history`, an MCP tool, or an interrupted run)')
    .option('--timeout <seconds>', 'Stop waiting after this many seconds (default: until the run ends; the run itself keeps going)')
    .option('--interval <seconds>', 'Seconds between status checks', '3')
    .option('--download [path]', 'Save outputs locally when it finishes (optional path template, e.g. "./out/{index}.{ext}")')
    .option('--output-dir <dir>', 'Directory for --download when no path is given')
    .option('--json', 'Emit the prediction record as JSON (with done: true|false)')
    .action(async (id: string, opts: any) => {
      let spinner: ReturnType<typeof ora> | null = null;
      try {
        const timeout = parseSeconds(opts.timeout, '--timeout');
        const interval = parseSeconds(opts.interval, '--interval', 3)!;
        const deadline = timeout === undefined ? Infinity : Date.now() + timeout * 1000;
        const started = Date.now();
        spinner = !opts.json ? ora(`Waiting for ${id}…`).start() : null;
        let item: HistoryItem;
        let done: boolean;
        for (;;) {
          item = await fetchPredictionWithRetry(id, 1000);
          done = !isInProgress(item.status);
          if (done || Date.now() + interval * 1000 > deadline) break;
          if (spinner) spinner.text = `Waiting for ${id}: ${item.status} (${Math.round((Date.now() - started) / 1000)}s)`;
          await new Promise((r) => setTimeout(r, interval * 1000));
        }
        spinner?.stop();
        if (!done && !opts.json) {
          console.error(`Still ${item.status || 'running'} after ${timeout}s. The run keeps going on the server: run \`wavespeed wait ${id}\` again later.`);
        }
        await renderPrediction(item, id, done ? opts : { ...opts, download: undefined }, { done });
        process.exitCode = waitExitCode(item, done);
      } catch (err: any) {
        spinner?.fail(err.message ?? String(err));
        if (opts.json) {
          process.stdout.write(JSON.stringify({ error: err.message ?? String(err) }, null, 2) + '\n');
        } else if (!spinner) {
          console.error(err.message ?? String(err));
        }
        process.exitCode = WAIT_EXIT.failed;
      }
    });
}
