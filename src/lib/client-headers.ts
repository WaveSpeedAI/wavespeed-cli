// Channel-attribution headers (X-Client-Name / X-Client-Version / X-Client-OS)
// for the CLI's direct REST calls, matching the convention wavespeed-desktop
// uses. Calls that go through the `wavespeed` SDK get the same headers from
// the SDK itself (via the clientName option in client.ts).

import os from 'node:os';
import { VERSION } from './version.js';

export const CLI_CLIENT_NAME = 'wavespeed-cli';

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
    'X-Client-Version': VERSION,
    'X-Client-OS': operatingSystem(),
  };
}
