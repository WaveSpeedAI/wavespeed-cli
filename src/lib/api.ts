// Thin direct-API helpers for endpoints not exposed by the `wavespeed` SDK.
// The SDK only covers run() + upload(). For the catalog and balance we hit the
// REST API directly.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getApiKey, getBaseUrl } from './config.js';

// Mirrors the /api/v3/models response shape — see ../wavespeed-desktop/src/types/model.ts
// (note: live `api_schema` has `api_schemas[0].request_schema`, not the OpenAPI-nested form.)
export interface LiveModel {
  model_id: string;
  name: string;
  description?: string;
  type?: string;
  base_price?: number;
  sort_order?: number;
  formula?: string;
  api_schema?: {
    api_schemas?: Array<{
      type?: string;
      method?: string;
      server?: string;
      api_path?: string;
      request_schema?: {
        type?: string;
        properties?: Record<string, unknown>;
        required?: string[];
        ['x-order-properties']?: string[];
      };
    }>;
  };
}

interface ModelsEnvelope {
  code: number;
  message?: string;
  data: LiveModel[];
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function cachePath(): string {
  return path.join(os.homedir(), '.cache', 'wavespeed', 'models.json');
}

interface CacheFile {
  fetched_at: number;
  base_url: string;
  models: LiveModel[];
}

function readCache(baseUrl: string): LiveModel[] | null {
  try {
    const raw = fs.readFileSync(cachePath(), 'utf8');
    const parsed = JSON.parse(raw) as CacheFile;
    if (parsed.base_url !== baseUrl) return null;
    if (Date.now() - parsed.fetched_at > CACHE_TTL_MS) return null;
    return parsed.models;
  } catch {
    return null;
  }
}

function writeCache(baseUrl: string, models: LiveModel[]): void {
  try {
    fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
    const body: CacheFile = { fetched_at: Date.now(), base_url: baseUrl, models };
    fs.writeFileSync(cachePath(), JSON.stringify(body));
  } catch {
    /* best-effort cache; ignore failures */
  }
}

export interface FetchModelsOptions {
  noCache?: boolean;
  refresh?: boolean;
}

export async function fetchModels(opts: FetchModelsOptions = {}): Promise<{
  models: LiveModel[];
  source: 'cache' | 'live';
}> {
  const baseUrl = getBaseUrl();

  if (!opts.noCache && !opts.refresh) {
    const cached = readCache(baseUrl);
    if (cached) return { models: cached, source: 'cache' };
  }

  const apiKey = getApiKey();
  if (!apiKey) throw new Error('No API key configured. Run `wavespeed login`.');

  const res = await fetch(`${baseUrl}/api/v3/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`GET /api/v3/models failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as ModelsEnvelope;
  if (json.code !== 200) {
    throw new Error(json.message || `API returned code ${json.code}`);
  }

  if (!opts.noCache) writeCache(baseUrl, json.data);
  return { models: json.data, source: 'live' };
}

export function clearModelsCache(): void {
  try {
    fs.unlinkSync(cachePath());
  } catch {
    /* nothing to clear */
  }
}
