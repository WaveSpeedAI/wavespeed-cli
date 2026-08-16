import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { fetchPricing } from '../lib/api.js';
import { parseInputs } from '../lib/inputs.js';
import { resolveModelToken } from '../lib/config.js';
import { collectLocalFiles, resolveLocalFiles } from '../lib/local-files.js';
import { uploadWithCache } from '../lib/upload-cache.js';
import { requireClient } from '../lib/client.js';

export function registerPrice(program: Command): void {
  program
    .command('price')
    .description("Calculate the cost of running a model with specific inputs (no generation, no charge)")
    .argument('<model>', 'Model ID or alias')
    .option('-i, --input <pair...>', 'Inputs as key=value (same syntax as `wavespeed run`)', [])
    .option('-p, --prompt <text>', 'Shorthand for --input prompt=<text>')
    .option('--upload', 'Upload @file inputs first so media-based pricing is exact (quota applies; identical bytes cached 24h)')
    .option('--json', 'Emit JSON')
    .action(async (modelArg: string, opts: any) => {
      const resolved = resolveModelToken(modelArg);
      if (!resolved) {
        const msg = `"${modelArg}" is neither a model ID nor a known alias.`;
        if (opts.json) process.stdout.write(JSON.stringify({ error: msg }, null, 2) + '\n');
        else console.error(chalk.red('Error: ') + msg);
        process.exit(1);
      }

      let inputs: Record<string, unknown> = { ...(resolved.defaultInput ?? {}) };
      Object.assign(inputs, parseInputs(opts.input ?? []));
      if (opts.prompt) inputs.prompt = opts.prompt;

      // Pricing that depends on media (e.g. per-second video upscaling) is
      // measured server-side from the URL, so a local path is useless to the
      // pricing engine. Uploading is slow and quota-limited, so it is opt-in:
      // without --upload we stop and say why, rather than silently sending a
      // filesystem path and quoting from garbage.
      const localRefs = collectLocalFiles(inputs);
      let uploadedUrls: Record<string, string> = {};
      if (localRefs.length > 0 && !opts.upload) {
        const files = [...new Set(localRefs.map((r) => r.path))].join(', ');
        const msg =
          `Input references local file(s): ${files}. ` +
          'Pricing for media-dependent models is measured from a hosted URL. ' +
          'Re-run with --upload to upload them for an exact quote (uses upload quota; identical bytes are cached 24h), or pass a URL directly.';
        if (opts.json) process.stdout.write(JSON.stringify({ error: msg }, null, 2) + '\n');
        else console.error(chalk.red('Error: ') + msg);
        process.exit(1);
      }
      if (localRefs.length > 0 && opts.upload) {
        const client = requireClient();
        const upSpinner = !opts.json ? ora('Uploading for an exact quote…').start() : null;
        try {
          const resolvedFiles = await resolveLocalFiles(inputs, {
            upload: async (file) => {
              const { url, cached } = await uploadWithCache(file, (f) => client.upload(f));
              uploadedUrls[file] = url;
              if (cached) upSpinner && (upSpinner.text = 'Using cached upload…');
              return url;
            },
          });
          inputs = resolvedFiles.input;
          upSpinner?.succeed(
            resolvedFiles.uploaded > 0 ? 'Uploaded.' : 'All files already uploaded (cache).',
          );
        } catch (err: any) {
          upSpinner?.fail(err.message ?? String(err));
          if (opts.json) process.stdout.write(JSON.stringify({ error: err.message ?? String(err) }, null, 2) + '\n');
          process.exit(1);
        }
      }

      const spinner = !opts.json ? ora('Calculating price…').start() : null;
      try {
        const data = await fetchPricing(resolved.model, inputs);
        spinner?.stop();

        if (opts.json) {
          process.stdout.write(JSON.stringify({ ...data, uploaded: uploadedUrls }, null, 2) + '\n');
          return;
        }

        console.log();
        const effective = data.discounted_price > 0 ? data.discounted_price : data.price;
        console.log(chalk.bold('Estimated cost'));
        console.log('  ' + chalk.gray('model:   ') + chalk.cyan(data.model_id));
        console.log(
          '  ' + chalk.gray('price:   ') + chalk.green(`$${effective}`) + chalk.gray(` ${data.currency ?? 'USD'} per call`) +
          (data.discounted_price > 0 && data.discounted_price !== data.price
            ? chalk.gray(`  (list $${data.price})`)
            : ''),
        );
        console.log();
        for (const [file, url] of Object.entries(uploadedUrls)) {
          console.log('  ' + chalk.gray('uploaded: ') + chalk.gray(file + ' → ') + chalk.cyan(url));
        }
        if (Object.keys(uploadedUrls).length > 0) {
          console.log('  ' + chalk.gray('`wavespeed run` reuses these uploads automatically (content-hash cache).'));
        }
        console.log();
        console.log(chalk.gray('Run it: ') + chalk.cyan(`wavespeed run ${modelArg}` + (opts.prompt ? ` -p "${opts.prompt}"` : '')));
        console.log();
      } catch (err: any) {
        spinner?.fail(err.message ?? String(err));
        if (opts.json) process.stdout.write(JSON.stringify({ error: err.message ?? String(err) }, null, 2) + '\n');
        process.exit(1);
      }
    });
}
