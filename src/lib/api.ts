// Thin direct-API helpers for endpoints not exposed by the `wavespeed` SDK.
// The SDK only covers run() + upload(). For the catalog and balance we hit the
// REST API directly.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getApiKey, getBaseUrl } from './config.js';
import { clientAttributionHeaders } from './client-headers.js';

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
    headers: { Authorization: `Bearer ${apiKey}`, ...clientAttributionHeaders() },
  });
  if (!res.ok) {
    throw await httpError(res, 'GET', '/api/v3/models');
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
  return { Authorization: `Bearer ${apiKey}`, ...clientAttributionHeaders() };
}

interface Envelope<T> {
  code: number;
  message?: string;
  data: T;
}

// Non-2xx responses still carry the platform's error envelope, and for
// permission failures that body is the whole point: it names the role that
// created the key and a role whose key would work. Throwing only the status
// line turned every 403 into an unactionable "403 Forbidden".
async function httpError(res: Response, method: string, path: string): Promise<Error> {
  let detail = '';
  try {
    const body = (await res.json()) as { message?: string; error_code?: string };
    if (body?.message) {
      detail = body.error_code ? `${body.message} [${body.error_code}]` : body.message;
    }
  } catch {
    /* non-JSON body (gateway error page, empty response) — fall back below */
  }
  if (detail) return new Error(detail);
  return new Error(`${method} ${path} failed: ${res.status} ${res.statusText}`);
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`, { headers: authHeaders() });
  if (!res.ok) throw await httpError(res, 'GET', path);
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
  if (!res.ok) throw await httpError(res, 'POST', path);
  const json = (await res.json()) as Envelope<T>;
  if (json.code !== 200) throw new Error(json.message || `API returned code ${json.code}`);
  return json.data;
}

export async function fetchBalance(): Promise<{ balance: number }> {
  return apiGet<{ balance: number }>('/api/v3/balance');
}

export interface ModelPrice {
  model_id: string;
  price: number;
  discounted_price: number;
  discount_rate?: number;
  currency?: string;
}

export async function fetchPricing(
  modelId: string,
  inputs: Record<string, unknown>,
): Promise<ModelPrice> {
  // /model/price is the documented pricing endpoint; /model/pricing is a
  // legacy contract kept for old clients and absent from the public docs.
  return apiPost('/api/v3/model/price', { model_id: modelId, inputs });
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

// Server-side prediction status enum (api-server internal/model/prediction.go).
// Validated client-side so `--status pending` fails with the real list instead
// of a server 400 or a silently empty page.
export const PREDICTION_STATUSES = [
  'created',
  'processing',
  'completed',
  'failed',
  'cancelled',
  'timeout',
  'deleted',
] as const;

export interface SubmitResult {
  id: string;
  status: string;
  outputs?: (string | Record<string, unknown>)[];
  error?: string;
  urls?: { get?: string };
  model?: string;
}

/**
 * Submit a prediction WITHOUT waiting for it. Split from polling so the
 * caller can print the prediction ID the moment it exists — a Ctrl+C or
 * dropped connection mid-generation must never orphan a paid task.
 */
export async function submitPrediction(
  model: string,
  input: Record<string, unknown>,
  opts: { sync?: boolean } = {},
): Promise<SubmitResult> {
  const body: Record<string, unknown> = { ...input };
  if (opts.sync) body.enable_sync_mode = true;
  return apiPost<SubmitResult>(`/api/v3/${model}`, body);
}

export type PollHandle = { cancel: () => void };

/**
 * Poll a prediction until it reaches a terminal status. `onTick` fires each
 * round so the caller can keep a spinner honest.
 */
export async function waitForPrediction(
  id: string,
  opts: { intervalMs?: number; onTick?: (status: string) => void; signal?: { cancelled: boolean } } = {},
): Promise<HistoryItem> {
  const interval = opts.intervalMs ?? 1000;
  for (;;) {
    const item = await fetchPrediction(id);
    opts.onTick?.(item.status);
    if (item.status === 'completed') return item;
    if (item.status === 'failed' || item.status === 'cancelled' || item.status === 'timeout' || item.status === 'deleted') {
      throw new Error(`Prediction ${item.status}${item.error ? `: ${item.error}` : ''} (task_id: ${id})`);
    }
    if (opts.signal?.cancelled) throw new Error(`cancelled (task_id: ${id})`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

// ---- Finance: billings, usage, per-prediction cost ----

export interface BillingItem {
  uuid: string;
  billing_type: string;
  price: number;
  created_at: string;
  access_key_name?: string;
  access_key_uuid?: string;
  order?: { uuid: string; state?: string; price?: number; origin_price?: number; status?: number };
  prediction?: { uuid: string; model_uuid?: string; status?: string };
  consumption?: Record<string, unknown>;
}

export interface BillingsQuery {
  page?: number;
  pageSize?: number;
  type?: string;
  startTime?: string;
  endTime?: string;
  model?: string;
  accessKey?: string;
}

export async function fetchBillings(
  query: BillingsQuery = {},
): Promise<{ page: number; has_more: boolean; items: BillingItem[] }> {
  const body: Record<string, unknown> = {
    page: query.page ?? 1,
    page_size: query.pageSize ?? 20,
  };
  if (query.type) body.billing_type = query.type;
  if (query.startTime) body.start_time = query.startTime;
  if (query.endTime) body.end_time = query.endTime;
  if (query.model) body.model_uuid = query.model;
  if (query.accessKey) body.access_key_uuid = query.accessKey;
  return apiPost('/api/v3/billings/search', body);
}

export interface UsageStats {
  per_model_usage: Array<{
    model_uuid: string;
    model_type?: string;
    unit_price?: number;
    total_cost: number;
    total_count?: number;
    last_used_date?: string;
  }>;
  daily_usage: Array<{ date: string; amount: number; count: number }>;
  summary: { total_cost: number; total_requests: number; success_requests: number };
}

export async function fetchUsageStats(
  startTime: string,
  endTime: string,
  model?: string,
): Promise<UsageStats> {
  const body: Record<string, unknown> = { start_time: startTime, end_time: endTime };
  if (model) body.model_uuid = model;
  return apiPost('/api/v3/user/usage_stats', body);
}
