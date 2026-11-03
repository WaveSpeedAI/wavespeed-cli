import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  waitForPrediction,
  submitPrediction,
  submitRetryDelayMs,
  SUBMIT_429_RETRIES,
  unavailableReason,
  inferenceMs,
} from './api.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
});

function reply(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
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

  it('is single-shot on 500 and 503', async () => {
    for (const status of [500, 503]) {
      const fn = stub([reply(status, {}), ok('created')]);
      const sleep = vi.fn(async () => {});
      await expect(submitPrediction('m/x', {}, { sleep })).rejects.toThrow(new RegExp(String(status)));
      expect(fn).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    }
  });

  it('retries the concurrency 429 honouring Retry-After, then succeeds', async () => {
    const limited = reply(
      429,
      { code: 429, message: 'too many concurrent requests. Retry shortly.' },
      { 'Retry-After': '1' },
    );
    const fn = stub([limited, limited, ok('created')]);
    const sleep = vi.fn(async (_ms: number) => {});
    const onRetry = vi.fn();
    const r = await submitPrediction('m/x', { prompt: 'p' }, { sleep, onRetry });
    expect(r.id).toBe('t1');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 1000]);
    expect(onRetry.mock.calls).toEqual([
      [1, 1000],
      [2, 1000],
    ]);
  });

  it('gives up after a bounded number of 429 retries with the API message', async () => {
    const fn = stub([reply(429, { code: 429, message: 'too many concurrent requests. Retry shortly.' })]);
    const sleep = vi.fn(async () => {});
    await expect(submitPrediction('m/x', {}, { sleep })).rejects.toThrow(/too many concurrent requests/);
    expect(fn).toHaveBeenCalledTimes(SUBMIT_429_RETRIES + 1);
    expect(sleep).toHaveBeenCalledTimes(SUBMIT_429_RETRIES);
  });

  it('backs off exponentially without Retry-After and caps long waits', () => {
    expect([0, 1, 2, 3].map((a) => submitRetryDelayMs(undefined, a))).toEqual([1000, 2000, 4000, 8000]);
    expect(submitRetryDelayMs(undefined, 6)).toBe(10_000);
    expect(submitRetryDelayMs('5', 0)).toBe(5000);
    expect(submitRetryDelayMs('120', 0)).toBe(10_000);
    expect(submitRetryDelayMs('Wed, 21 Oct 2026 07:28:00 GMT', 1)).toBe(2000);
  });
});

describe('records without a usable result', () => {
  it('stops polling on an empty status (archived, older API) instead of looping', async () => {
    const fn = stub([reply(200, { code: 200, data: { id: '', model: '', status: '', outputs: [], created_at: '' } })]);
    await expect(waitForPrediction('t1', { retryDelayMs: 1, intervalMs: 1 })).rejects.toThrow(
      /expired or are not available.*task_id: t1/,
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('shows the API error for an archived record with no outputs', async () => {
    const fn = stub([
      reply(200, {
        code: 200,
        data: { id: 't1', model: 'm/x', status: 'completed', outputs: [], error: 'The outputs of this prediction have expired.' },
      }),
    ]);
    await expect(waitForPrediction('t1', { retryDelayMs: 1, intervalMs: 1 })).rejects.toThrow(
      /The outputs of this prediction have expired\. \(task_id: t1\)/,
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('stops on an unknown status', async () => {
    stub([reply(200, { code: 200, data: { id: 't1', status: 'weird' } })]);
    await expect(waitForPrediction('t1', { retryDelayMs: 1, intervalMs: 1 })).rejects.toThrow(/Unexpected prediction status "weird"/);
  });

  it('keeps polling created/processing and still reports failures by status', async () => {
    const fn = stub([ok('created'), ok('processing'), ok('completed')]);
    await waitForPrediction('t1', { retryDelayMs: 1, intervalMs: 1 });
    expect(fn).toHaveBeenCalledTimes(3);
    stub([reply(200, { code: 200, data: { id: 't1', status: 'failed', error: 'boom' } })]);
    await expect(waitForPrediction('t1', { retryDelayMs: 1, intervalMs: 1 })).rejects.toThrow(/Prediction failed: boom/);
  });

  it('unavailableReason only flags records whose result is gone', () => {
    expect(unavailableReason({ id: 'a', model: 'm', status: 'completed', outputs: ['u'], created_at: '' })).toBeNull();
    expect(unavailableReason({ id: 'a', model: 'm', status: 'completed', outputs: [], created_at: '' })).toBeNull();
    expect(unavailableReason({ id: 'a', model: 'm', status: 'processing', created_at: '' })).toBeNull();
    expect(unavailableReason({ id: 'a', model: 'm', status: 'failed', error: 'x', created_at: '' })).toBeNull();
    expect(unavailableReason({ id: '', model: '', status: '', created_at: '' })).toMatch(/expired or are not available/);
    expect(unavailableReason({ id: 'a', model: 'm', status: '', error: 'gone', created_at: '' })).toBe('gone');
  });
});

describe('elapsed time', () => {
  it('reads timings.inference (the API never sends executionTime)', () => {
    expect(inferenceMs({ timings: { inference: 1234 } })).toBe(1234);
    expect(inferenceMs({ timings: { inference: 0 } })).toBeUndefined();
    expect(inferenceMs({})).toBeUndefined();
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
