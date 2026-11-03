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

// With enable_base64_output=true each URL output comes back as naked base64,
// but an output over 64 MiB or one the API failed to fetch stays a URL, and
// text/JSON outputs are unchanged — so the kind is decided per output.
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const DATA_URI_RE = /^data:([^;,]*)(?:;[^,]*)?;base64,(.*)$/s;

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/** Naked base64 as returned for enable_base64_output (short strings are treated as text). */
export function isBase64Output(value: string): boolean {
  return value.length >= 64 && value.length % 4 === 0 && BASE64_RE.test(value);
}

const MAGIC: [number[], string, number?][] = [
  [[0x89, 0x50, 0x4e, 0x47], 'png'],
  [[0xff, 0xd8, 0xff], 'jpg'],
  [[0x47, 0x49, 0x46, 0x38], 'gif'],
  [[0x1a, 0x45, 0xdf, 0xa3], 'webm'],
  [[0x49, 0x44, 0x33], 'mp3'],
  [[0x66, 0x4c, 0x61, 0x43], 'flac'],
  [[0x4f, 0x67, 0x67, 0x53], 'ogg'],
  [[0x67, 0x6c, 0x54, 0x46], 'glb'],
  [[0x50, 0x4b, 0x03, 0x04], 'zip'],
  [[0x25, 0x50, 0x44, 0x46], 'pdf'],
];

export function extFromBytes(buf: Buffer, fallback: string): string {
  for (const [sig, ext] of MAGIC) {
    if (sig.every((b, i) => buf[i] === b)) return ext;
  }
  const at = (o: number, s: string) => buf.subarray(o, o + s.length).toString('latin1') === s;
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'webp';
  if (at(0, 'RIFF') && at(8, 'WAVE')) return 'wav';
  if (at(4, 'ftyp')) return at(8, 'M4A') ? 'm4a' : at(8, 'qt') ? 'mov' : 'mp4';
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'mp3';
  return fallback;
}

const EXT_FROM_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/wav': 'wav',
};

/** Bytes of an inline (base64 or data URI) output, or null when it is not inline. */
function inlineBytes(value: string, fallbackExt: string): { buf: Buffer; ext: string } | null {
  const m = value.match(DATA_URI_RE);
  if (m) {
    const buf = Buffer.from(m[2], 'base64');
    return { buf, ext: EXT_FROM_MIME[m[1].toLowerCase()] ?? extFromBytes(buf, fallbackExt) };
  }
  if (!isBase64Output(value)) return null;
  const buf = Buffer.from(value, 'base64');
  return { buf, ext: extFromBytes(buf, fallbackExt) };
}

/** Short label for an output: URLs as-is, inline data summarised instead of dumped. */
export function describeOutput(value: string): string {
  if (isHttpUrl(value)) return value;
  const m = value.match(DATA_URI_RE);
  const b64 = m ? m[2] : isBase64Output(value) ? value : null;
  if (b64 === null) return value;
  const bytes = Math.floor((b64.length * 3) / 4);
  return `(base64 data, ${bytes >= 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + ' MB' : Math.ceil(bytes / 1024) + ' KB'})`;
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
    const inline = isHttpUrl(url) ? null : inlineBytes(url, opts.ext || 'bin');
    const ext = inline ? inline.ext : extFromUrl(url, opts.ext || 'bin');
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

    if (inline) {
      fs.writeFileSync(filepath, inline.buf);
      saved.push(filepath);
      continue;
    }
    if (!isHttpUrl(url)) {
      throw new Error(`Output ${i + 1} is neither a URL nor base64 data, so it cannot be downloaded: ${url.slice(0, 80)}`);
    }
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
  for (const u of remote) console.log('  ' + chalk.cyan(describeOutput(u)));
  console.log();
}
