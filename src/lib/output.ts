import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import chalk from 'chalk';
import { resolveOutputDir } from './config.js';

const EXT_FROM_URL = /\.([a-z0-9]{2,5})(?:\?|#|$)/i;

function extFromUrl(url: string, fallback: string): string {
  const m = url.match(EXT_FROM_URL);
  if (m) return m[1].toLowerCase();
  return fallback;
}

function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

export interface DownloadOptions {
  prompt?: string;
  model?: string;
  outputDir?: string;
  ext?: string;
  /**
   * Destination template. When set, supports tokens:
   *   {index}  1-based index
   *   {ext}    extension inferred from the URL
   *   {stamp}  ISO timestamp
   *   {slug}   slug of prompt/model
   * Examples:
   *   "./out.png"                  → ./out.png (single only)
   *   "./out/{index}.{ext}"        → ./out/1.png, ./out/2.png
   *   "{stamp}-{slug}-{index}.{ext}"
   */
  template?: string;
}

function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

export async function downloadOutputs(
  urls: string[],
  opts: DownloadOptions = {},
): Promise<string[]> {
  const baseDir = path.resolve(opts.outputDir || resolveOutputDir());
  const ts = stamp();
  const tag = opts.prompt ? slug(opts.prompt) : opts.model ? slug(opts.model) : 'output';
  const saved: string[] = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const ext = extFromUrl(url, opts.ext || 'bin');
    let filepath: string;

    if (opts.template) {
      const rendered = renderTemplate(opts.template, {
        index: String(i + 1),
        ext,
        stamp: ts,
        slug: tag,
      });
      filepath = path.resolve(rendered);
      // Single-output, no {index} → use the template path verbatim.
      // Multi-output, no {index} → suffix to avoid clobbering.
      if (urls.length > 1 && !opts.template.includes('{index}')) {
        const parsed = path.parse(filepath);
        filepath = path.join(parsed.dir, `${parsed.name}-${i + 1}${parsed.ext}`);
      }
    } else {
      const suffix = urls.length > 1 ? `-${i + 1}` : '';
      filepath = path.join(baseDir, `${ts}-${tag}${suffix}.${ext}`);
    }

    fs.mkdirSync(path.dirname(filepath), { recursive: true });

    const res = await fetch(url);
    if (!res.ok || !res.body) {
      throw new Error(`Download failed for ${url}: ${res.status} ${res.statusText}`);
    }
    await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(filepath));
    saved.push(filepath);
  }

  return saved;
}

export function printOutputs(saved: string[], remote: string[]): void {
  console.log();
  if (saved.length) {
    console.log(chalk.green('Saved:'));
    for (const f of saved) console.log('  ' + chalk.cyan(path.relative(process.cwd(), f)));
    console.log();
  }
  console.log(chalk.gray(saved.length ? 'Source URLs:' : 'URLs:'));
  for (const u of remote) console.log('  ' + chalk.cyan(u));
  console.log();
}
