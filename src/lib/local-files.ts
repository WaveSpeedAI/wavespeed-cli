// Turn local file paths in a model's input into hosted URLs.
//
// Uploading is cheap now that the platform hands out a presigned PUT and the
// bytes go straight to object storage, so making the user run `upload` first
// and paste the URL back is pure friction. This module finds the paths and
// swaps them for URLs; run.ts does it once, right before submitting.
//
// Two ways to point at a file:
//
//   -i image=@./cat.png    explicit — always uploaded, missing file is an error
//   -i image=./cat.png     implicit — uploaded only if it looks like media AND
//                          exists on disk; otherwise passed through untouched
//
// The implicit rule is deliberately narrow. A model input that happens to
// match a filename in the working directory must not be silently replaced by
// a URL, so a bare value has to clear both the extension check and the
// existence check. Anything already a URL is left alone.

import fs from 'node:fs';
import path from 'node:path';

// Extensions the platform's models actually accept as inputs. Kept explicit
// rather than "any file that exists": a bare `-i seed=1.txt` should stay a
// string even in a directory that happens to contain 1.txt.
const MEDIA_EXTENSIONS = new Set([
  // images
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.tif', '.heic', '.heif', '.avif',
  // video
  '.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v',
  // audio
  '.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus',
]);

// Free-text fields never auto-detect: `-p ./notes.txt` means that literal
// string. An explicit `@` still works if someone genuinely wants it.
const NO_IMPLICIT_DETECTION = new Set(['prompt', 'negative_prompt', 'system_prompt']);

export interface LocalFileRef {
  /** Path as written by the user, `@` already stripped. */
  path: string;
  /** Dotted location in the input object, e.g. `image_urls.0`. */
  at: string;
  /** True when the user wrote `@` and we must fail rather than pass through. */
  explicit: boolean;
}

export interface DetectOptions {
  /** Injected for tests; defaults to a real regular-file check. */
  exists?: (p: string) => boolean;
}

function isRegularFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isUrl(value: string): boolean {
  return /^(https?:|data:|s3:|gs:)/i.test(value);
}

/**
 * Walk the input and list every value that should become an upload. Pure over
 * `exists`, so the decision rules can be tested without touching the disk.
 */
export function collectLocalFiles(
  input: unknown,
  opts: DetectOptions = {},
): LocalFileRef[] {
  const exists = opts.exists ?? isRegularFile;
  const found: LocalFileRef[] = [];

  const walk = (node: unknown, at: string, key: string): void => {
    if (Array.isArray(node)) {
      // Arrays inherit the key of their container, so `image_urls.0` is still
      // judged as `image_urls` — element indices are not field names.
      node.forEach((v, i) => walk(v, at ? `${at}.${i}` : String(i), key));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        walk(v, at ? `${at}.${k}` : k, k);
      }
      return;
    }
    if (typeof node !== 'string' || node === '') return;

    if (node.startsWith('@')) {
      found.push({ path: node.slice(1), at, explicit: true });
      return;
    }
    if (isUrl(node)) return;
    if (NO_IMPLICIT_DETECTION.has(key)) return;
    if (!MEDIA_EXTENSIONS.has(path.extname(node).toLowerCase())) return;
    if (!exists(node)) return;

    found.push({ path: node, at, explicit: false });
  };

  walk(input, '', '');
  return found;
}

function setAt(root: any, dotted: string, value: unknown): void {
  const parts = dotted.split('.');
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
  cur[parts[parts.length - 1]] = value;
}

export interface ResolveOptions extends DetectOptions {
  /** Uploads one file and resolves to its hosted URL. */
  upload: (filePath: string) => Promise<string>;
  /** Called once per distinct file before its upload starts. */
  onUpload?: (filePath: string, index: number, total: number) => void;
}

/**
 * Replace local paths in `input` with uploaded URLs. Returns a new object;
 * the caller's input is not mutated. Distinct paths upload once even when
 * referenced several times — the same image passed as two fields is one
 * upload, not two.
 */
export async function resolveLocalFiles(
  input: Record<string, unknown>,
  opts: ResolveOptions,
): Promise<{ input: Record<string, unknown>; uploaded: number }> {
  const refs = collectLocalFiles(input, opts);
  if (refs.length === 0) return { input, uploaded: 0 };

  const missing = refs.filter((r) => r.explicit && !(opts.exists ?? isRegularFile)(r.path));
  if (missing.length > 0) {
    throw new Error(
      `File not found: ${missing.map((m) => m.path).join(', ')}`,
    );
  }

  const distinct = [...new Set(refs.map((r) => path.resolve(r.path)))];
  const urls = new Map<string, string>();
  for (const [i, abs] of distinct.entries()) {
    opts.onUpload?.(abs, i, distinct.length);
    urls.set(abs, await opts.upload(abs));
  }

  const out = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  for (const ref of refs) {
    setAt(out, ref.at, urls.get(path.resolve(ref.path))!);
  }
  return { input: out, uploaded: distinct.length };
}
