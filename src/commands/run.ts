import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'node:path';
import fs from 'node:fs';
import { requireClient } from '../lib/client.js';
import { parseInputs } from '../lib/inputs.js';
import { downloadOutputs, printOutputs } from '../lib/output.js';
import { emitJson, emitJsonError, isJsonMode, log, setJsonMode } from '../lib/log.js';
import { downloadOptsFromFlag } from '../lib/download-flag.js';
import { resolveModelToken } from '../lib/config.js';

function extractUrls(output: any): string[] {
  if (!output) return [];
  if (Array.isArray(output.outputs)) {
    return output.outputs.filter((u: any) => typeof u === 'string');
  }
  if (typeof output.url === 'string') return [output.url];
  return [];
}

type SyncTimeoutDetails = {
  predictionId?: string;
  resultUrl?: string;
};

function cleanTrailingPunctuation(value: string): string {
  return value.replace(/[).,]+$/, '');
}

function extractSyncTimeoutDetails(message: string): SyncTimeoutDetails | null {
  if (!message.includes('Sync mode timed out')) return null;

  const taskIdMatch =
    message.match(/task_id:\s*([^)]+)/) ??
    message.match(/Prediction ID:\s*([^\s.]+)/);
  const resultUrlMatch = message.match(/Query the result later at:\s*(\S+)/);

  return {
    predictionId: taskIdMatch?.[1] ? cleanTrailingPunctuation(taskIdMatch[1]) : undefined,
    resultUrl: resultUrlMatch?.[1] ? cleanTrailingPunctuation(resultUrlMatch[1]) : undefined,
  };
}

function failMissingModel(): never {
  const msg =
    'No model specified. Pass a model ID as the first argument, ' +
    'set `defaultModel` in wavespeed.json, or `wavespeed config --default-model <id>`.';
  if (isJsonMode()) emitJsonError(msg);
  else {
    console.error(chalk.red('Error: ') + msg);
    console.error(chalk.gray('Browse models: ') + chalk.cyan('wavespeed models'));
  }
  process.exit(1);
}

function failUnknownAlias(token: string): never {
  const msg = `"${token}" is neither a model ID (no \`/\`) nor a known alias.`;
  if (isJsonMode()) emitJsonError(msg);
  else {
    console.error(chalk.red('Error: ') + msg);
    console.error(chalk.gray('  See aliases: ') + chalk.cyan('wavespeed aliases'));
    console.error(chalk.gray('  Browse models: ') + chalk.cyan('wavespeed models'));
  }
  process.exit(1);
}

export function registerRun(program: Command): void {
  program
    .command('run')
    .description('Run any Wavespeed model — generic invoke with --input key=value pairs')
    .argument('[model]', 'Model ID, alias name, or omit to use defaultModel.')
    .option('-i, --input <pair...>', 'Inputs as key=value (repeatable). Use dotted keys for nested.', [])
    .option('-p, --prompt <text>', 'Shorthand for --input prompt=<text>')
    .option('--input-file <path>', 'JSON file with full input object')
    .option('--download [path]', 'Save outputs locally (optional path template, e.g. "./out/{index}.{ext}")')
    .option('--sync', 'Attempt sync mode; timed-out tasks can still be queried later')
    .option('--json', 'Emit a single JSON object on stdout (progress goes to stderr)')
    .option('--output-dir <dir>', 'Directory for --download when no path is given')
    .action(async (modelArg: string | undefined, opts: any) => {
      setJsonMode(!!opts.json);

      // Resolve positional → underlying model + any default input from an alias.
      const resolved = resolveModelToken(modelArg);
      if (!resolved) {
        if (modelArg) failUnknownAlias(modelArg);
        failMissingModel();
      }
      const model = resolved.model;
      const aliasDefaults = resolved.defaultInput ?? {};
      const aliasName = resolved.alias;

      const client = requireClient();

      // Merge order: alias defaults < --input-file < --input k=v < -p prompt
      let input: Record<string, unknown> = { ...aliasDefaults };
      if (opts.inputFile) {
        Object.assign(input, JSON.parse(fs.readFileSync(path.resolve(opts.inputFile), 'utf8')));
      }
      Object.assign(input, parseInputs(opts.input ?? []));
      if (opts.prompt) input.prompt = opts.prompt;

      log('');
      log(
        chalk.bold('▶ ') +
          chalk.cyan(model) +
          (aliasName ? chalk.gray(`  (alias: ${aliasName})`) : ''),
      );
      if (input.prompt) log(chalk.gray('  prompt: ') + chalk.white(String(input.prompt)));

      const spinner = ora({ text: 'Submitting…', color: 'magenta' });
      if (!isJsonMode()) spinner.start();
      const startedAt = Date.now();
      let result: any;
      try {
        const iv = setInterval(() => {
          const s = Math.floor((Date.now() - startedAt) / 1000);
          spinner.text = `Generating… ${s}s`;
        }, 200);
        try {
          result = await client.run(model, input, { enableSyncMode: !!opts.sync });
        } finally {
          clearInterval(iv);
        }
        spinner.succeed(`Done in ${Math.floor((Date.now() - startedAt) / 1000)}s.`);
      } catch (err: any) {
        const message = err.message ?? String(err);
        const syncTimeout = opts.sync ? extractSyncTimeoutDetails(message) : null;

        if (syncTimeout && !isJsonMode()) {
          spinner.fail('Sync mode timed out; the task is still processing asynchronously.');
          log(chalk.gray('  reason: ') + message);
          if (syncTimeout.predictionId) {
            log(chalk.gray('  prediction: ') + chalk.white(syncTimeout.predictionId));
            log(chalk.gray('  query:      ') + chalk.cyan(`wavespeed show ${syncTimeout.predictionId}`));
          }
          if (syncTimeout.resultUrl) {
            log(chalk.gray('  result URL: ') + chalk.cyan(syncTimeout.resultUrl));
          }
        } else {
          spinner.fail(message);
        }

        if (isJsonMode()) {
          emitJsonError(
            message,
            syncTimeout
              ? {
                  sync_timeout: true,
                  prediction_id: syncTimeout.predictionId,
                  result_url: syncTimeout.resultUrl,
                  query_command: syncTimeout.predictionId
                    ? `wavespeed show ${syncTimeout.predictionId}`
                    : undefined,
                }
              : {},
          );
        }
        process.exit(1);
      }

      const urls = extractUrls(result);
      let saved: string[] = [];

      const dlOpts = downloadOptsFromFlag(opts.download, {
        model,
        prompt: typeof input.prompt === 'string' ? input.prompt : undefined,
        outputDir: opts.outputDir,
      });
      if (urls.length > 0 && dlOpts) {
        const dlSpinner = ora('Downloading outputs…');
        if (!isJsonMode()) dlSpinner.start();
        try {
          saved = await downloadOutputs(urls, dlOpts);
          dlSpinner.succeed(`Saved ${saved.length} file${saved.length > 1 ? 's' : ''}.`);
        } catch (err: any) {
          dlSpinner.fail(err.message ?? String(err));
        }
      }

      if (isJsonMode()) {
        emitJson({
          model,
          prompt: typeof input.prompt === 'string' ? input.prompt : undefined,
          outputs: urls,
          saved,
          elapsed_ms: Date.now() - startedAt,
          raw: result,
        });
        return;
      }

      if (urls.length === 0) {
        log(chalk.yellow('No output URLs in response. Full payload:'));
        log(JSON.stringify(result, null, 2));
        return;
      }
      printOutputs(saved, urls);
    });
}
