import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { fetchPricing } from '../lib/api.js';
import { parseInputs } from '../lib/inputs.js';
import { resolveModelToken } from '../lib/config.js';

export function registerPrice(program: Command): void {
  program
    .command('price')
    .description("Calculate the cost of running a model with specific inputs (no generation, no charge)")
    .argument('<model>', 'Model ID or alias')
    .option('-i, --input <pair...>', 'Inputs as key=value (same syntax as `wavespeed run`)', [])
    .option('-p, --prompt <text>', 'Shorthand for --input prompt=<text>')
    .option('--json', 'Emit JSON')
    .action(async (modelArg: string, opts: any) => {
      const resolved = resolveModelToken(modelArg);
      if (!resolved) {
        const msg = `"${modelArg}" is neither a model ID nor a known alias.`;
        if (opts.json) process.stdout.write(JSON.stringify({ error: msg }, null, 2) + '\n');
        else console.error(chalk.red('Error: ') + msg);
        process.exit(1);
      }

      const inputs: Record<string, unknown> = { ...(resolved.defaultInput ?? {}) };
      Object.assign(inputs, parseInputs(opts.input ?? []));
      if (opts.prompt) inputs.prompt = opts.prompt;

      const spinner = !opts.json ? ora('Calculating price…').start() : null;
      try {
        const data = await fetchPricing(resolved.model, inputs);
        spinner?.stop();

        if (opts.json) {
          process.stdout.write(JSON.stringify(data, null, 2) + '\n');
          return;
        }

        console.log();
        console.log(chalk.bold('Estimated cost'));
        console.log('  ' + chalk.gray('model:   ') + chalk.cyan(data.model_id));
        console.log('  ' + chalk.gray('price:   ') + chalk.green(`$${data.unit_price}`) + chalk.gray(` ${data.currency ?? 'USD'} per call`));
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
