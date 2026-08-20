// Channel-attribution headers (X-Client-Name / X-Client-Version / X-Client-OS)
// for the CLI's direct REST calls, matching the convention wavespeed-desktop
// uses. Calls that go through the `wavespeed` SDK get the same headers from
// the SDK itself (via the clientName option in client.ts).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const CLI_CLIENT_NAME = 'wavespeed-cli';

// Read version from package.json at runtime so a bump in package.json is
// reflected automatically (same approach as cli.ts).
function cliVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // dist/lib/client-headers.js → ../../package.json
    const pkgPath = path.resolve(here, '..', '..', 'package.json');
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version as string;
  } catch {
    return '0.0.0';
  }
}

// Lowercase OS name: darwin / linux / windows (win32 is reported as windows).
function operatingSystem(): string {
  const platform = os.platform();
  return platform === 'win32' ? 'windows' : platform;
}

// The WAVESPEED_CLIENT_NAME environment variable takes priority so wrapper
// channels (dsh skill, Claude plugin, Gemini extension) can brand themselves
// without code changes.
export function resolveClientName(): string {
  return process.env.WAVESPEED_CLIENT_NAME || CLI_CLIENT_NAME;
}

export function clientAttributionHeaders(): Record<string, string> {
  return {
    'X-Client-Name': resolveClientName(),
    'X-Client-Version': cliVersion(),
    'X-Client-OS': operatingSystem(),
  };
}
