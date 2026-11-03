// Thin direct-API helpers for endpoints not exposed by the `wavespeed` SDK.
// The SDK only covers run() + upload(). For the catalog and balance we hit the
// REST API directly.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { callerCacheId, getApiKey, getBaseUrl } from './config.js';
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

// The catalog is per caller: the API serves internal users, paid
// organizations and everyone else different model lists. So the cache is one
// file per (base URL, API key), `models-<callerCacheId>.json`, shared with the
// MCP server (same name and format). The old shared `models.json` is left
// alone for older versions that still read it; this version never uses it.
export function modelsCacheFile(baseUrl: string, apiKey: string): string {
  return path.join(os.homedir(), '.cache', 'wavespeed', `models-${callerCacheId(baseUrl, apiKey)}.json`);
}

interface CacheFile {
  fetched_at: number;
  base_url: string;
  models: LiveModel[];
}

function readCache(file: string, baseUrl: string): LiveModel[] | null {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as CacheFile;
    if (parsed.base_url !== baseUrl) return null;
    if (Date.now() - parsed.fetched_at > CACHE_TTL_MS) return null;
    return parsed.models;
  } catch {
    return null;
  }
}

function writeCache(file: string, baseUrl: string, models: LiveModel[]): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const body: CacheFile = { fetched_at: Date.now(), base_url: baseUrl, models };
    fs.writeFileSync(file, JSON.stringify(body));
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
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('No API key configured. Run `wavespeed login`.');
  const file = modelsCacheFile(baseUrl, apiKey);

  if (!opts.noCache && !opts.refresh) {
    const cached = readCache(file, baseUrl);
    if (cached) return { models: cached, source: 'cache' };
  }

  const res = await fetch(`${baseUrl}/api/v3/models`, {
    headers: { Authorization: `Bearer ${apiKey}`, ...clientAttributionHeaders() },
    signal: AbortSignal.timeout(GET_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw await httpError(res, 'GET', '/api/v3/models');
  }
  const json = (await res.json()) as ModelsEnvelope;
  if (json.code !== 200) {
    throw new Error(json.message || `API returned code ${json.code}`);
  }

  if (!opts.noCache) writeCache(file, baseUrl, json.data);
  return { models: json.data, source: 'live' };
}

/** Removes the current key's catalog cache. */
export function clearModelsCache(): void {
  const apiKey = getApiKey();
  if (!apiKey) return;
  try {
    fs.unlinkSync(modelsCacheFile(getBaseUrl(), apiKey));
  } catch {
    /* nothing to clear */
  }
}

// Per-request timeouts (no overall cap). A hung socket would otherwise stall
// the CLI forever. Read-only GETs are far below 30s in practice (result p99.9
// < 1s); the async submit gets more headroom because a timeout there is an
// ambiguous outcome, not a clean failure.
export const GET_TIMEOUT_MS = 30_000;
export const SUBMIT_TIMEOUT_MS = 60_000;

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
  const err: Error & { status?: number; retryAfter?: string } = detail
    ? new Error(detail)
    : new Error(`${method} ${path} failed: ${res.status} ${res.statusText}`);
  err.status = res.status;
  const retryAfter = res.headers.get('retry-after');
  if (retryAfter) err.retryAfter = retryAfter;
  return err;
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(GET_TIMEOUT_MS),
  });
  if (!res.ok) throw await httpError(res, 'GET', path);
  const json = (await res.json()) as Envelope<T>;
  if (json.code !== 200) throw new Error(json.message || `API returned code ${json.code}`);
  return json.data;
}

async function apiPost<T>(path: string, body: unknown, opts: { timeoutMs?: number } = {}): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined,
  });
  if (!res.ok) throw await httpError(res, 'POST', path);
  const json = (await res.json()) as Envelope<T>;
  if (json.code !== 200) throw new Error(json.message || `API returned code ${json.code}`);
  return json.data;
}

export async function fetchBalance(): Promise<{ balance: number }> {
  return apiGet<{ balance: number }>('/api/v3/balance');
}

// The model's page on the site, where it can be tried in the playground.
export function modelPlaygroundUrl(modelId: string): string {
  return `https://wavespeed.ai/models/${modelId}`;
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
  /** `inference` is the run time in milliseconds. */
  timings?: { inference?: number };
  error?: string;
}

/** The run time in ms the API reports (`timings.inference`), or undefined when absent or zero. */
export function inferenceMs(item: Pick<HistoryItem, 'timings'>): number | undefined {
  const ms = item.timings?.inference;
  return typeof ms === 'number' && ms > 0 ? ms : undefined;
}

// Statuses a prediction moves on from; anything else ends polling.
const IN_PROGRESS_STATUSES = new Set(['created', 'processing']);
const FAILED_STATUSES = new Set(['failed', 'cancelled', 'timeout', 'deleted']);

function hasOutputs(item: HistoryItem): boolean {
  return Array.isArray(item.outputs) && item.outputs.length > 0;
}

/**
 * Why a prediction record carries no usable result, or null when it does (or
 * is still running, or failed with its own status). Covers records whose
 * outputs are gone: an archived prediction comes back with an empty status
 * (older API) or a completed status with no outputs and an error saying the
 * outputs expired. The API's error text wins when it sent one.
 */
export function unavailableReason(item: HistoryItem): string | null {
  const status = item.status ?? '';
  if (status === 'completed') {
    return !hasOutputs(item) && item.error ? item.error : null;
  }
  if (IN_PROGRESS_STATUSES.has(status) || FAILED_STATUSES.has(status)) return null;
  if (item.error) return item.error;
  return status
    ? `Unexpected prediction status "${status}"; outputs are not available.`
    : 'The outputs of this prediction have expired or are not available.';
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

// Same set as wavespeed-python. A thrown error with no HTTP status is a
// network failure or timeout; envelope/JSON errors carry no status either but
// never reach here as a transient fault, so only fetch-level errors count.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_POLL_RETRIES = 5;

function isTransient(err: any): boolean {
  if (typeof err?.status === 'number') return RETRYABLE_STATUS.has(err.status);
  return err instanceof TypeError || err?.name === 'TimeoutError' || err?.name === 'AbortError';
}

async function fetchPredictionWithRetry(id: string, retryDelayMs: number): Promise<HistoryItem> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchPrediction(id);
    } catch (err: any) {
      const reason = err?.message ?? String(err);
      if (!isTransient(err)) throw new Error(`${reason} (task_id: ${id})`);
      if (attempt >= MAX_POLL_RETRIES) {
        throw new Error(
          `Status check failed after ${attempt + 1} attempts: ${reason} (task_id: ${id}) — the task may still be running`,
        );
      }
      await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
    }
  }
}

// The API takes at most 100 ids per delete request.
export const DELETE_BATCH_SIZE = 100;

export interface DeleteResult {
  /** Ids the server actually deleted. */
  deleted_ids: string[];
  /** Requested ids it did not delete: not this organization's, still running, or already gone. */
  not_deleted_ids: string[];
}

/**
 * Delete predictions in batches of 100. The server soft-deletes only the
 * caller organization's predictions that are not running and returns the ids
 * it deleted, so the result reports those, not the ids asked for. A failed
 * batch throws with the result so far attached as `partial`.
 */
export async function deletePredictions(ids: string[]): Promise<DeleteResult> {
  const unique = [...new Set(ids)];
  const deleted: string[] = [];
  for (let i = 0; i < unique.length; i += DELETE_BATCH_SIZE) {
    const chunk = unique.slice(i, i + DELETE_BATCH_SIZE);
    try {
      const data = await apiPost<{ deleted_count?: number; deleted_ids?: string[] | null }>(
        '/api/v3/predictions/delete',
        { ids: chunk },
      );
      deleted.push(...(data?.deleted_ids ?? []));
    } catch (err: any) {
      const done = new Set(deleted);
      err.partial = { deleted_ids: deleted, not_deleted_ids: unique.filter((id) => !done.has(id)) } as DeleteResult;
      throw err;
    }
  }
  const done = new Set(deleted);
  return { deleted_ids: deleted, not_deleted_ids: unique.filter((id) => !done.has(id)) };
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

// A submit is retried only on HTTP 429: the API's rate and concurrency
// limiters answer it before any prediction exists, so a retry cannot create a
// second task. Timeouts, network errors and 5xx are never retried — the task
// may already exist and be billed.
export const SUBMIT_429_RETRIES = 4;
const SUBMIT_RETRY_MAX_DELAY_MS = 10_000;

/** Wait before retry `attempt` (0-based): the server's Retry-After seconds when given, else 1s, 2s, 4s…; capped at 10s. */
export function submitRetryDelayMs(retryAfter: string | undefined, attempt: number): number {
  const seconds = retryAfter !== undefined && /^\s*\d+(\.\d+)?\s*$/.test(retryAfter) ? Number(retryAfter) : NaN;
  const ms = Number.isFinite(seconds) ? seconds * 1000 : 1000 * 2 ** attempt;
  return Math.min(ms, SUBMIT_RETRY_MAX_DELAY_MS);
}

/**
 * Submit a prediction WITHOUT waiting for it. Split from polling so the
 * caller can print the prediction ID the moment it exists — a Ctrl+C or
 * dropped connection mid-generation must never orphan a paid task.
 */
export async function submitPrediction(
  model: string,
  input: Record<string, unknown>,
  opts: {
    sync?: boolean;
    /** Called before each 429 retry with the wait in ms. */
    onRetry?: (attempt: number, delayMs: number) => void;
    /** Test hook for the retry wait. */
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<SubmitResult> {
  const body: Record<string, unknown> = { ...input };
  if (opts.sync) body.enable_sync_mode = true;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await submitOnce(model, body, !!opts.sync);
    } catch (err: any) {
      if (err?.status !== 429 || attempt >= SUBMIT_429_RETRIES) throw err;
      const delay = submitRetryDelayMs(err.retryAfter, attempt);
      opts.onRetry?.(attempt + 1, delay);
      await sleep(delay);
    }
  }
}

async function submitOnce(model: string, body: Record<string, unknown>, sync: boolean): Promise<SubmitResult> {
  // sync mode legitimately holds the request until the task finishes, so only
  // async submits get the per-request timeout.
  try {
    return await apiPost<SubmitResult>(`/api/v3/${model}`, body, {
      timeoutMs: sync ? undefined : SUBMIT_TIMEOUT_MS,
    });
  } catch (err: any) {
    // Never retried: the server may already have created (and billed) the task.
    if (err?.name === 'TimeoutError') {
      throw new Error(
        `Submission outcome unknown: no response within ${SUBMIT_TIMEOUT_MS / 1000}s. The task may have been created — run \`wavespeed history\` to check before retrying.`,
      );
    }
    throw err;
  }
}

export type PollHandle = { cancel: () => void };

/**
 * Poll a prediction until it reaches a terminal status. `onTick` fires each
 * round so the caller can keep a spinner honest. Transient status-read
 * failures are retried. An empty or unknown status, or a completed record
 * whose outputs are gone, ends polling with an error instead of looping.
 */
export async function waitForPrediction(
  id: string,
  opts: { intervalMs?: number; retryDelayMs?: number; onTick?: (status: string) => void; signal?: { cancelled: boolean } } = {},
): Promise<HistoryItem> {
  const interval = opts.intervalMs ?? 1000;
  for (;;) {
    const item = await fetchPredictionWithRetry(id, opts.retryDelayMs ?? 1000);
    opts.onTick?.(item.status);
    const unavailable = unavailableReason(item);
    if (unavailable) throw new Error(`${unavailable} (task_id: ${id})`);
    if (item.status === 'completed') return item;
    if (FAILED_STATUSES.has(item.status)) {
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
