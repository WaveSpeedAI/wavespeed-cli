import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_NAME = '@wavespeed/cli';

// Injected by scripts/build-binary.mjs for the standalone executable, which has
// no package.json next to it. Undefined under npm / tsx.
declare const __WS_VERSION__: string | undefined;

/** True when running as the standalone executable rather than under Node + npm. */
export const IS_STANDALONE = typeof __WS_VERSION__ === 'string';

// Otherwise read package.json at runtime so a bump is reflected automatically
// (no second place to keep in sync).
export const VERSION: string = IS_STANDALONE ? __WS_VERSION__! : (() => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/lib/version.js (or src/lib/version.ts) → ../../package.json
  const pkgPath = path.resolve(here, '..', '..', 'package.json');
  return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version as string;
})();

/** Parse "1.2.3" (optionally "v"-prefixed / with a -prerelease or +build tail) into numbers. */
function parse(v: string): number[] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True when `latest` is strictly newer than `current`. Unparseable input → false. */
export function isNewer(latest: string, current: string): boolean {
  const a = parse(latest);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/** Release asset name for this platform, e.g. wavespeed-linux-x64, wavespeed-windows-x64.exe. */
export function assetName(platform: string = process.platform, arch: string = process.arch): string {
  const os = platform === 'win32' ? 'windows' : platform;
  return `wavespeed-${os}-${arch}${platform === 'win32' ? '.exe' : ''}`;
}
