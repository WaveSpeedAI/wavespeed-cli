// `wavespeed run <model> --help` introspects the model's request schema and
// prints the actual flags the model accepts (matches genmedia's behavior).
//
// Called from cli.ts BEFORE Commander parses, so we can intercept --help.

import chalk from 'chalk';
import { fetchModels, LiveModel } from './api.js';
import { findAlias } from './config.js';

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
}

function getRequestSchema(m: LiveModel): {
  properties?: Record<string, SchemaProp>;
  required?: string[];
  ['x-order-properties']?: string[];
} | undefined {
  return m.api_schema?.api_schemas?.[0]?.request_schema as any;
}

function typeLabel(p: SchemaProp): string {
  if (Array.isArray(p.type)) return p.type.join('|');
  if (p.type === 'array' && p.items?.type) return `${p.items.type}[]`;
  return p.type ?? 'any';
}

function wrap(text: string, indent: string, width = 92): string {
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

/**
 * Detect `wavespeed run <model> --help` (or `-h`) in argv. Returns the model id
 * if matched, else null. Order doesn't matter (`--help` can come before or after
 * the model).
 */
export function detectRunHelp(argv: string[]): string | null {
  const args = argv.slice(2);
  if (args[0] !== 'run') return null;
  if (!args.some((a) => a === '--help' || a === '-h')) return null;
  // Find the first positional that looks like a model id (contains '/').
  // We allow any non-flag token though — even a typo'd id should trigger this
  // path so the error message guides the user.
  for (const a of args.slice(1)) {
    if (!a.startsWith('-')) return a;
  }
  return null;
}

export async function printDynamicRunHelp(token: string): Promise<void> {
  // Resolve aliases up-front so `wavespeed run <alias> -h` shows the underlying
  // model's schema. Track the alias name + its default input for the example.
  let modelId = token;
  let aliasName: string | undefined;
  let aliasDefaults: Record<string, unknown> | undefined;
  if (!token.includes('/')) {
    const alias = findAlias(token);
    if (alias) {
      modelId = alias.model;
      aliasName = token;
      aliasDefaults = alias.input;
    }
  }

  let payload: { models: LiveModel[] };
  try {
    payload = await fetchModels({});
  } catch (err: any) {
    // Offline / not signed in — defer to static help.
    process.stderr.write(
      chalk.gray(
        `(Could not fetch live schema: ${err.message ?? String(err)}. Falling back to static help.)\n`,
      ),
    );
    return;
  }

  const model = payload.models.find((m) => m.model_id === modelId);
  if (!model) {
    process.stdout.write(
      chalk.yellow(`Unknown model "${modelId}".`) +
        chalk.gray(`  Try `) +
        chalk.cyan(`wavespeed models "${modelId.split('/').pop()}"`) +
        chalk.gray(' to search.\n'),
    );
    process.exit(1);
  }

  const schema = getRequestSchema(model);
  if (!schema?.properties) {
    process.stdout.write(
      chalk.yellow(`Model "${modelId}" has no published schema.`) +
        chalk.gray('  Run it generically with `-i k=v` pairs.\n'),
    );
    process.exit(0);
  }

  const required = new Set(schema.required ?? []);
  const order = (schema['x-order-properties'] ?? Object.keys(schema.properties)).filter(
    (k) => k in schema.properties!,
  );

  console.log();
  console.log(
    chalk.hex('#7c5cff').bold(`  wavespeed run ${aliasName ?? model.model_id}`) +
      (aliasName ? chalk.gray(`  →  ${model.model_id}`) : ''),
  );
  console.log(
    chalk.gray('  type:  ') +
      chalk.white(model.type ?? 'unknown') +
      (model.base_price !== undefined
        ? chalk.gray('   base price: ') + chalk.green(`$${model.base_price}`)
        : ''),
  );
  console.log(chalk.gray('  page:  ') + chalk.cyan(`https://wavespeed.ai/models/${model.model_id}`));
  if (model.description) console.log(wrap(model.description, '  '));
  if (aliasDefaults && Object.keys(aliasDefaults).length > 0) {
    console.log();
    console.log(chalk.gray('  alias defaults: ') + chalk.gray(JSON.stringify(aliasDefaults)));
  }
  console.log();
  console.log(
    chalk.bold('Usage:  ') +
      chalk.cyan(`wavespeed run ${aliasName ?? model.model_id}`) +
      chalk.gray(' [-i key=value ...] [--download [path]] [--json]'),
  );
  console.log();

  console.log(
    chalk.bold('Inputs') +
      chalk.gray(`  (${order.length} field${order.length === 1 ? '' : 's'}, ${required.size} required)`),
  );
  console.log();
  const nameWidth = Math.max(...order.map((n) => n.length), 8);
  for (const name of order) {
    const p = schema.properties[name]!;
    const flag = required.has(name) ? chalk.red('*') : ' ';
    const t = chalk.magenta(typeLabel(p).padEnd(10));
    console.log(`  ${flag} ${chalk.cyan(name.padEnd(nameWidth))}  ${t}`);
    if (p.description) console.log(wrap(p.description, '    '.padEnd(nameWidth + 6)));
    const tail: string[] = [];
    if (p.default !== undefined) tail.push(`default: ${JSON.stringify(p.default)}`);
    if (p.enum) tail.push(`enum: ${p.enum.map((v) => String(v)).join(' | ')}`);
    if (p.minimum !== undefined || p.maximum !== undefined)
      tail.push(`range: ${p.minimum ?? '−∞'}..${p.maximum ?? '∞'}`);
    if (p.minItems !== undefined || p.maxItems !== undefined)
      tail.push(`items: ${p.minItems ?? 0}..${p.maxItems ?? '∞'}`);
    if (tail.length) console.log(' '.repeat(nameWidth + 6) + chalk.gray(tail.join('  ·  ')));
  }

  // Build a copy-paste example: required fields + prompt, skipping anything
  // already supplied by an alias's defaults.
  const seedFields = [...required];
  if (!required.has('prompt') && 'prompt' in schema.properties) seedFields.push('prompt');
  const example = seedFields
    .filter((n) => !aliasDefaults || !(n in aliasDefaults))
    .map((n) => {
      const p = schema.properties![n];
      if (p?.default !== undefined) return `-i ${n}=${JSON.stringify(p.default)}`;
      if (p?.enum?.length) return `-i ${n}=${JSON.stringify(p.enum[0])}`;
      if (n.includes('prompt')) return `-i ${n}="…"`;
      if (n.includes('image') || n.includes('url')) return `-i ${n}="<url>"`;
      return `-i ${n}="…"`;
    })
    .join(' ');

  console.log();
  console.log(chalk.bold('Example:'));
  console.log(
    `  ${chalk.cyan(
      'wavespeed run ' + (aliasName ?? model.model_id) + (example ? ' ' + example : ''),
    )}`,
  );
  console.log();
  process.exit(0);
}
