import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'node:path';
import fs from 'node:fs';
import { requireClient } from '../lib/client.js';
import { parseInputs, withInputSyntaxHint } from '../lib/inputs.js';
import { resolveLocalFiles } from '../lib/local-files.js';
import { fetchModels, submitPrediction, waitForPrediction, SubmitResult } from '../lib/api.js';
import { findUnknownInputs } from '../lib/validate-inputs.js';
import { uploadWithCache } from '../lib/upload-cache.js';
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

function failWith(msg: string): never {
  if (isJsonMode()) emitJsonError(msg);
  else console.error(chalk.red('Error: ') + msg);
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
    .option('-i, --input <pair...>', 'Inputs as key=value (repeatable). @path uploads a local file and passes its URL. Dotted keys nest.', [])
    .option('-p, --prompt <text>', 'Shorthand for --input prompt=<text>')
    .option('--input-file <path>', 'JSON file with full input object')
    .option('--download [path]', 'Save outputs locally (optional path template, e.g. "./out/{index}.{ext}")')
    .option('--sync', 'Attempt sync mode; timed-out tasks can still be queried later')
    .option('--no-validate', 'Skip pre-submit input validation against the model schema')
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

      // Reject inputs the model's schema does not declare BEFORE anything
      // costs money. The API's entry whitelist silently drops unknown keys,
      // so a typo doesn't fail — it bills a generation that ignored the
      // parameter. Validation fails open (no schema → no check) and, to
      // avoid stale-cache false positives, re-fetches the catalog once
      // before rejecting.
      if (opts.validate !== false) {
        try {
          let { models } = await fetchModels();
          let found = models.find((m) => m.model_id === model);
          let report = findUnknownInputs(input, found);
          if (report) {
            ({ models } = await fetchModels({ refresh: true }));
            found = models.find((m) => m.model_id === model);
            report = findUnknownInputs(input, found);
          }
          if (report) {
            const lines = report.unknown.map((k) => {
              const hint = report!.suggestions.get(k);
              return `  ${k}` + (hint ? `  (did you mean \`${hint}\`?)` : '');
            });
            const msg =
              `Model ${model} does not accept: ${report.unknown.join(', ')}. ` +
              `The API silently drops unknown inputs, so this would bill a run that ignores them.`;
            if (isJsonMode()) {
              emitJsonError(msg, { unknown_inputs: report.unknown, accepted_inputs: report.known });
            } else {
              console.error(chalk.red('Error: ') + `unknown input${report.unknown.length > 1 ? 's' : ''} for ` + chalk.cyan(model) + ':');
              for (const l of lines) console.error(chalk.yellow(l));
              console.error(chalk.gray('  The API silently drops unknown inputs — the run would be billed with them ignored.'));
              console.error(chalk.gray('  Accepted inputs: ') + report.known.join(', '));
              console.error(chalk.gray('  Full schema:     ') + chalk.cyan(`wavespeed schema ${model}`));
              console.error(chalk.gray('  Bypass check:    ') + chalk.cyan('--no-validate'));
            }
            process.exit(1);
          }
        } catch {
          // Catalog unreachable — validation is best-effort, never a blocker.
          // (The unknown-input rejection above exits the process directly and
          // is not routed through here.)
        }
      }

      // `@path` inputs become hosted URLs before submission. Only the
      // explicit @ marker uploads — the CLI never guesses that a bare value
      // was meant to be a file.
      try {
        const uploadSpinner = !isJsonMode() ? ora({ color: 'magenta' }) : null;
        const resolved = await resolveLocalFiles(input, {
          upload: async (file) => (await uploadWithCache(file, (f) => client.upload(f))).url,
          onUpload: (file, i, total) => {
            uploadSpinner?.start(
              total > 1
                ? `Uploading ${path.basename(file)} (${i + 1}/${total})…`
                : `Uploading ${path.basename(file)}…`,
            );
          },
        });
        if (resolved.uploaded > 0) {
          uploadSpinner?.succeed(
            `Uploaded ${resolved.uploaded} file${resolved.uploaded === 1 ? '' : 's'}.`,
          );
        }
        input = resolved.input;
      } catch (err: any) {
        failWith(err.message ?? String(err));
      }

      log('');
      log(
        chalk.bold('▶ ') +
          chalk.cyan(model) +
          (aliasName ? chalk.gray(`  (alias: ${aliasName})`) : ''),
      );
      if (input.prompt) log(chalk.gray('  prompt: ') + chalk.white(String(input.prompt)));

      // Submit and poll are deliberately separate calls. The moment the task
      // exists we print its ID and arm a SIGINT handler — a paid generation
      // must never be orphaned by a Ctrl+C or a dropped SSH session with the
      // user left holding nothing to query.
      const spinner = ora({ text: 'Submitting…', color: 'magenta' });
      if (!isJsonMode()) spinner.start();
      const startedAt = Date.now();
      let submitted: SubmitResult;
      try {
        submitted = await submitPrediction(model, input, { sync: !!opts.sync });
      } catch (err: any) {
        const message = withInputSyntaxHint(err.message ?? String(err), opts.input);
        spinner.fail(message);
        if (isJsonMode()) emitJsonError(message);
        process.exit(1);
      }

      const predictionId = submitted.id;
      if (predictionId && !isJsonMode()) {
        spinner.stopAndPersist({
          symbol: chalk.gray('·'),
          text: chalk.gray('prediction: ') + chalk.white(predictionId),
        });
        spinner.start('Generating…');
      }

      const abortNote = () => {
        // Runs on Ctrl+C while the task is still going server-side. The task
        // is NOT cancelled — it completes and is charged — so hand the user
        // the way back to it.
        process.stderr.write(
          '\n' +
            chalk.yellow('Interrupted — the task keeps running on the server.') +
            '\n' +
            (predictionId
              ? chalk.gray('  resume:  ') + chalk.cyan(`wavespeed show ${predictionId}`) + '\n'
              : ''),
        );
        process.exit(130);
      };
      if (predictionId) process.on('SIGINT', abortNote);

      let result: any;
      try {
        if (submitted.status === 'completed') {
          // Sync mode finished within the request.
          result = submitted;
        } else if (!predictionId) {
          throw new Error(`No prediction ID in response: ${JSON.stringify(submitted)}`);
        } else {
          const iv = setInterval(() => {
            const s = Math.floor((Date.now() - startedAt) / 1000);
            spinner.text = `Generating… ${s}s`;
          }, 200);
          try {
            result = await waitForPrediction(predictionId, { intervalMs: 1000 });
          } finally {
            clearInterval(iv);
          }
        }
        spinner.succeed(`Done in ${Math.floor((Date.now() - startedAt) / 1000)}s.`);
      } catch (err: any) {
        const message = err.message ?? String(err);
        spinner.fail(message);
        if (predictionId && !isJsonMode()) {
          log(chalk.gray('  prediction: ') + chalk.white(predictionId));
          log(chalk.gray('  query:      ') + chalk.cyan(`wavespeed show ${predictionId}`));
        }
        if (isJsonMode()) {
          emitJsonError(message, predictionId ? { prediction_id: predictionId, query_command: `wavespeed show ${predictionId}` } : {});
        }
        process.exit(1);
      } finally {
        if (predictionId) process.removeListener('SIGINT', abortNote);
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
          id: predictionId,
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
