import { describe, it, expect, afterEach, vi } from 'vitest';
import { waitForPrediction, submitPrediction } from './api.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
});

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}
const ok = (s: string) => reply(200, { code: 200, data: { id: 't1', status: s, outputs: ['u'] } });

function stub(responses: Array<Response | Error>) {
  vi.stubEnv('WAVESPEED_API_KEY', 'test');
  let i = 0;
  const fn = vi.fn(async () => {
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r instanceof Error) throw r;
    return r.clone();
  });
  globalThis.fetch = fn as any;
  return fn;
}

describe('waitForPrediction retries', () => {
  it('survives two 502s then succeeds', async () => {
    const fn = stub([reply(502, {}), reply(502, {}), ok('completed')]);
    const item = await waitForPrediction('t1', { retryDelayMs: 1, intervalMs: 1 });
    expect(item.status).toBe('completed');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('retries network errors', async () => {
    const fn = stub([new TypeError('fetch failed'), ok('completed')]);
    await waitForPrediction('t1', { retryDelayMs: 1, intervalMs: 1 });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('persistent 502 fails with the task id', async () => {
    const fn = stub([reply(502, {})]);
    await expect(waitForPrediction('t1', { retryDelayMs: 1 })).rejects.toThrow(/task_id: t1/);
    expect(fn).toHaveBeenCalledTimes(6);
  });

  it('does not retry 401', async () => {
    const fn = stub([reply(401, { message: 'bad key' })]);
    await expect(waitForPrediction('t1', { retryDelayMs: 1 })).rejects.toThrow(/bad key.*t1/);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('submitPrediction', () => {
  it('is single-shot on 502', async () => {
    const fn = stub([reply(502, {}), ok('created')]);
    await expect(submitPrediction('m/x', {})).rejects.toThrow(/502/);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('per-request timeouts', () => {
  it('submit uses a 60s signal, status GET 30s, sync submit none', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    stub([ok('created'), ok('completed')]);
    await submitPrediction('m/x', {});
    await waitForPrediction('t1', { retryDelayMs: 1 });
    await submitPrediction('m/x', {}, { sync: true });
    expect(spy.mock.calls.map((c) => c[0])).toEqual([60_000, 30_000]);
    spy.mockRestore();
  });

  it('submit timeout gives the ambiguous message with exactly one POST', async () => {
    const fn = stub([new DOMException('timed out', 'TimeoutError'), ok('created')]);
    await expect(submitPrediction('m/x', {})).rejects.toThrow(/outcome unknown.*may have been created/);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
