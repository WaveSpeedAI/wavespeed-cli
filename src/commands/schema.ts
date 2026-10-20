import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { fetchModels, LiveModel } from '../lib/api.js';

interface SchemaProp {
  type?: string | string[];
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  items?: { type?: string };
  disabled?: boolean;
}

interface RequestSchema {
  type?: string;
  properties?: Record<string, SchemaProp>;
  required?: string[];
  ['x-order-properties']?: string[];
}

function getRequestSchema(model: LiveModel): RequestSchema | undefined {
  return model.api_schema?.api_schemas?.[0]?.request_schema as RequestSchema | undefined;
}

function orderedProps(schema: RequestSchema): string[] {
  const all = Object.keys(schema.properties ?? {});
  const order = schema['x-order-properties'];
  if (!order) return all;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of order) if (k in (schema.properties ?? {}) && !seen.has(k)) { out.push(k); seen.add(k); }
  for (const k of all) if (!seen.has(k)) out.push(k);
  return out;
}

function typeLabel(prop: SchemaProp): string {
  if (Array.isArray(prop.type)) return prop.type.join('|');
  if (prop.type === 'array' && prop.items?.type) return `${prop.items.type}[]`;
  return prop.type ?? 'any';
}

function wrap(text: string, indent: string, width = 88): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).length > width - indent.length) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = cur ? cur + ' ' + w : w;
    }
  }
  if (cur) lines.push(cur);
  return lines.map((l) => indent + chalk.gray(l)).join('\n');
}

function exampleValue(name: string, prop: SchemaProp): string {
  if (prop.default !== undefined) return JSON.stringify(prop.default);
  if (prop.enum && prop.enum.length) return JSON.stringify(prop.enum[0]);
  const t = Array.isArray(prop.type) ? prop.type[0] : prop.type;
  if (t === 'integer' || t === 'number') return String(prop.minimum ?? 1);
  if (t === 'boolean') return 'true';
  if (t === 'array') return '"<url>"';
  if (name.toLowerCase().includes('prompt')) return '"…"';
  if (name.toLowerCase().includes('image') || name.toLowerCase().includes('url')) return '"<url>"';
  return '"…"';
}

export function registerSchema(program: Command): void {
  program
    .command('schema')
    .description('Show the input schema for a model — what params it accepts and which are required')
    .argument('<model>', 'Model ID (e.g. wavespeed-ai/z-image/turbo). Run `wavespeed models` to find them.')
    .option('--json', 'Emit the raw JSON schema on stdout')
    .option('--refresh', 'Force a live fetch (bypass the 1h cache)')
    .action(async (modelId: string, opts: { json?: boolean; refresh?: boolean }) => {
      const spinner = !opts.json ? ora('Loading catalog…').start() : null;
      let models: LiveModel[];
      try {
        ({ models } = await fetchModels({ refresh: opts.refresh }));
      } catch (err: any) {
        spinner?.fail(err.message ?? String(err));
        if (opts.json) {
          process.stdout.write(JSON.stringify({ error: err.message ?? String(err) }, null, 2) + '\n');
        }
        process.exit(1);
      }
      spinner?.stop();

      const model = models.find((m) => m.model_id === modelId);
      if (!model) {
        const msg = `Unknown model "${modelId}". Run \`wavespeed models "${modelId.split('/').pop()}"\` to search.`;
        if (opts.json) process.stdout.write(JSON.stringify({ error: msg }, null, 2) + '\n');
        else console.error(chalk.red(msg));
        process.exit(1);
      }

      const schema = getRequestSchema(model);
      if (!schema) {
        const msg = `Model "${modelId}" has no published input schema.`;
        if (opts.json) process.stdout.write(JSON.stringify({ error: msg }, null, 2) + '\n');
        else console.error(chalk.yellow(msg));
        process.exit(1);
      }

      if (opts.json) {
        process.stdout.write(JSON.stringify(schema, null, 2) + '\n');
        return;
      }

      const requiredSet = new Set(schema.required ?? []);
      const props = schema.properties ?? {};
      const order = orderedProps(schema);

      console.log();
      console.log(chalk.bold('▶ ') + chalk.cyan(model.model_id));
      console.log(
        chalk.gray('  type:  ') +
          chalk.white(model.type ?? 'unknown') +
          (model.base_price !== undefined ? chalk.gray('   base price: ') + chalk.green(`$${model.base_price}`) : ''),
      );
      console.log(chalk.gray('  page:  ') + chalk.cyan(`https://wavespeed.ai/models/${model.model_id}`));
      if (model.description) {
        console.log(wrap(model.description, '  '));
      }
      console.log();
      console.log(chalk.bold(`Inputs  ${chalk.gray(`(${order.length} field${order.length === 1 ? '' : 's'}, ${requiredSet.size} required)`)}`));
      console.log();

      const nameWidth = Math.max(...order.map((n) => n.length), 8);
      for (const name of order) {
        const p = props[name];
        const flag = requiredSet.has(name) ? chalk.red('*') : ' ';
        const t = chalk.magenta(typeLabel(p).padEnd(10));
        console.log(`  ${flag} ${chalk.cyan(name.padEnd(nameWidth))}  ${t}`);
        if (p.description) console.log(wrap(p.description, '    '.padEnd(nameWidth + 6)));
        const tail: string[] = [];
        if (p.default !== undefined) tail.push(`default: ${JSON.stringify(p.default)}`);
        if (p.enum) tail.push(`enum: ${p.enum.map((v) => String(v)).join(' | ')}`);
        if (p.minimum !== undefined || p.maximum !== undefined) tail.push(`range: ${p.minimum ?? '−∞'}..${p.maximum ?? '∞'}`);
        if (p.minItems !== undefined || p.maxItems !== undefined) tail.push(`items: ${p.minItems ?? 0}..${p.maxItems ?? '∞'}`);
        if (tail.length) console.log(' '.repeat(nameWidth + 6) + chalk.gray(tail.join('  ·  ')));
      }

      // Build a copy-paste run example using required fields (and prompt if present).
      const seedFields = [...requiredSet];
      if (!requiredSet.has('prompt') && 'prompt' in props) seedFields.push('prompt');
      const seedParts = seedFields.map((n) => `-i ${n}=${exampleValue(n, props[n])}`);

      console.log();
      console.log(chalk.bold('Try it:'));
      console.log(
        '  ' +
          chalk.cyan(`wavespeed run ${model.model_id}` + (seedParts.length ? ' ' + seedParts.join(' ') : '')),
      );
      console.log();
    });
}
