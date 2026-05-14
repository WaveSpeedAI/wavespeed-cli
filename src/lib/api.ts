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

// --- Account + prediction endpoints (not exposed by the wavespeed SDK) ---

function authHeaders(): Record<string, string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('No API key configured. Run `wavespeed login`.');
  return { Authorization: `Bearer ${apiKey}` };
}

interface Envelope<T> {
  code: number;
  message?: string;
  data: T;
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as Envelope<T>;
  if (json.code !== 200) throw new Error(json.message || `API returned code ${json.code}`);
  return json.data;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as Envelope<T>;
  if (json.code !== 200) throw new Error(json.message || `API returned code ${json.code}`);
  return json.data;
}

export async function fetchBalance(): Promise<{ balance: number }> {
  return apiGet<{ balance: number }>('/api/v3/balance');
}

export async function fetchPricing(
  modelId: string,
  inputs: Record<string, unknown>,
): Promise<{ model_id: string; unit_price: number; currency?: string }> {
  return apiPost('/api/v3/model/pricing', { model_id: modelId, inputs });
}

export interface HistoryItem {
  id: string;
  model: string;
  status: string;
  outputs?: (string | Record<string, unknown>)[];
  inputs?: Record<string, unknown>;
  input?: Record<string, unknown>;
  created_at: string;
  executionTime?: number;
  error?: string;
}

export interface HistoryQuery {
  page?: number;
  pageSize?: number;
  model?: string;
  status?: string;
  createdAfter?: string;
  createdBefore?: string;
}

export async function fetchHistory(
  query: HistoryQuery = {},
): Promise<{ page: number; items: HistoryItem[] }> {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const body: Record<string, unknown> = {
    page: query.page ?? 1,
    page_size: query.pageSize ?? 20,
    created_after: query.createdAfter ?? oneDayAgo.toISOString(),
    created_before: query.createdBefore ?? now.toISOString(),
    include_inputs: true,
  };
  if (query.model) body.model = query.model;
  if (query.status) body.status = query.status;
  return apiPost('/api/v3/predictions', body);
}

export async function fetchPrediction(id: string): Promise<HistoryItem> {
  return apiGet<HistoryItem>(`/api/v3/predictions/${id}/result`);
}

export async function deletePredictions(ids: string[]): Promise<void> {
  await apiPost('/api/v3/predictions/delete', { ids });
}
