// Content-addressed cache of uploaded files: sha256(file bytes) → hosted URL.
//
// Uploads are quota-limited per organization and slow for large videos, while
// the same file routinely goes up more than once — `price --upload` followed
// by `run`, or the same reference image across a batch of runs. Hashing the
// bytes (not the path) means a renamed or copied file still hits.
//
// TTL is 24h: hosted media does not expire that fast, but a bounded window
// keeps the cache from ever serving a URL the platform has since removed.
//
// One file per caller, `uploads-<callerCacheId>.json` (a hash of base URL +
// API key, never the key itself): an upload belongs to the account that made
// it, so another key on the same machine must not reuse it. Same name and
// format as the MCP server, so both tools share a key's uploads. The old
// shared `uploads.json` is left alone for older versions.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { callerCacheId, getApiKey, getBaseUrl } from './config.js';

const TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
  url: string;
  uploaded_at: number;
}

export function uploadCacheFile(cacheId: string = callerCacheId(getBaseUrl(), getApiKey())): string {
  return path.join(os.homedir(), '.cache', 'wavespeed', `uploads-${cacheId}.json`);
}

function readCache(file: string): Record<string, CacheEntry> {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function writeCache(file: string, entries: Record<string, CacheEntry>): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(entries));
  } catch {
    /* best-effort; a failed cache write must never fail the upload */
  }
}

export function hashFile(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * Upload through `doUpload` unless the identical bytes already went up within
 * the TTL. Returns the hosted URL either way.
 */
export async function uploadWithCache(
  filePath: string,
  doUpload: (p: string) => Promise<string>,
): Promise<{ url: string; cached: boolean }> {
  const key = hashFile(filePath);
  const file = uploadCacheFile();
  const entries = readCache(file);
  const hit = entries[key];
  if (hit && Date.now() - hit.uploaded_at < TTL_MS) {
    return { url: hit.url, cached: true };
  }
  const url = await doUpload(filePath);
  entries[key] = { url, uploaded_at: Date.now() };
  // Drop expired entries while we are here so the file stays small.
  for (const [k, v] of Object.entries(entries)) {
    if (Date.now() - v.uploaded_at >= TTL_MS) delete entries[k];
  }
  writeCache(file, entries);
  return { url, cached: false };
}
