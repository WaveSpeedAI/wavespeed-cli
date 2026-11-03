import { describe, it, expect, afterEach, vi } from 'vitest';
import { deletePredictions, DELETE_BATCH_SIZE } from './api.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
});

// Mimics POST /api/v3/predictions/delete: max 100 ids, deletes only `deletable`.
function server(deletable: Set<string>) {
  vi.stubEnv('WAVESPEED_API_KEY', 'test');
  const bodies: string[][] = [];
  const fn = vi.fn(async (_url: string, init: RequestInit) => {
    const ids = JSON.parse(String(init.body)).ids as string[];
    bodies.push(ids);
    if (ids.length > 100) return new Response(JSON.stringify({ code: 400, message: 'too many ids' }), { status: 400 });
    const deleted = ids.filter((id) => deletable.has(id));
    return new Response(
      JSON.stringify({ code: 200, data: { deleted_count: deleted.length, deleted_ids: deleted } }),
      { status: 200 },
    );
  });
  globalThis.fetch = fn as any;
  return { fn, bodies };
}

describe('deletePredictions', () => {
  it('reports what the server deleted, not what was asked', async () => {
    server(new Set(['a', 'c']));
    const r = await deletePredictions(['a', 'b', 'c']);
    expect(r.deleted_ids).toEqual(['a', 'c']);
    expect(r.not_deleted_ids).toEqual(['b']);
  });

  it('sends at most 100 ids per request', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id${i}`);
    const { bodies } = server(new Set(ids.filter((_, i) => i % 2 === 0)));
    const r = await deletePredictions(ids);
    expect(DELETE_BATCH_SIZE).toBe(100);
    expect(bodies.map((b) => b.length)).toEqual([100, 100, 50]);
    expect(r.deleted_ids).toHaveLength(125);
    expect(r.not_deleted_ids).toHaveLength(125);
  });

  it('treats a null deleted_ids as nothing deleted and de-duplicates input', async () => {
    vi.stubEnv('WAVESPEED_API_KEY', 'test');
    const fn = vi.fn(async () => new Response(JSON.stringify({ code: 200, data: { deleted_count: 0, deleted_ids: null } })));
    globalThis.fetch = fn as any;
    const r = await deletePredictions(['x', 'x']);
    expect(r).toEqual({ deleted_ids: [], not_deleted_ids: ['x'] });
    expect(JSON.parse(String((fn.mock.calls[0] as any)[1].body)).ids).toEqual(['x']);
  });

  it('attaches the partial result when a later batch fails', async () => {
    vi.stubEnv('WAVESPEED_API_KEY', 'test');
    let call = 0;
    globalThis.fetch = vi.fn(async (_u: string, init: RequestInit) => {
      const ids = JSON.parse(String(init.body)).ids as string[];
      if (call++ === 0) {
        return new Response(JSON.stringify({ code: 200, data: { deleted_count: ids.length, deleted_ids: ids } }));
      }
      return new Response(JSON.stringify({ code: 500, message: 'Failed to delete predictions' }), { status: 500 });
    }) as any;
    const ids = Array.from({ length: 150 }, (_, i) => `id${i}`);
    const err: any = await deletePredictions(ids).catch((e) => e);
    expect(err.message).toMatch(/Failed to delete predictions/);
    expect(err.partial.deleted_ids).toHaveLength(100);
    expect(err.partial.not_deleted_ids).toHaveLength(50);
  });
});
