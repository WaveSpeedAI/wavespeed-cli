// Shared --download flag handling for image/video/run.
//
// Behavior (matches genmedia):
//   (no flag)                  → no download, print URLs
//   --download                 → save to outputDir with smart filename
//   --download "./out.png"     → save to that path (single output)
//   --download "./out/{index}.{ext}"  → templated path (multi output)

import type { DownloadOptions } from './output.js';

// Commander hands `--download` with no value as boolean `true`. With a value it
// gives us the string. With nothing, the property is `undefined`.
export function resolveDownloadOpt(value: unknown): {
  enabled: boolean;
  template?: string;
} {
  if (value === undefined) return { enabled: false };
  if (value === true) return { enabled: true };
  if (typeof value === 'string' && value.length > 0) return { enabled: true, template: value };
  return { enabled: false };
}

export function downloadOptsFromFlag(
  flagValue: unknown,
  base: Pick<DownloadOptions, 'prompt' | 'model' | 'outputDir'>,
): DownloadOptions | null {
  const r = resolveDownloadOpt(flagValue);
  if (!r.enabled) return null;
  return { ...base, template: r.template };
}
