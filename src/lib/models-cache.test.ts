import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fetchModels, modelsCacheFile } from './api.js';

const realFetch = globalThis.fetch;
let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-cache-'));
  vi.stubEnv('HOME', home);
  vi.stubEnv('WAVESPEED_BASE_URL', 'https://api.example.test');
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

function catalogServer() {
  // Each key sees its own catalog, as the API serves public / paid / internal lists.
  const fn = vi.fn(async (_url: string, init: RequestInit) => {
    const key = String((init.headers as Record<string, string>).Authorization).replace('Bearer ', '');
    const tier = key.split('-').pop();
    return new Response(JSON.stringify({ code: 200, data: [{ model_id: `only/${tier}`, name: tier }] }));
  });
  globalThis.fetch = fn as any;
  return fn;
}

describe('models cache', () => {
  it('names the file by sha256(base_url + "\\n" + key), first 16 hex, shared with @wavespeed/mcp', () => {
    const expected = crypto.createHash('sha256').update('https://api.example.test\nsk-1').digest('hex').slice(0, 16);
    const file = modelsCacheFile('https://api.example.test', 'sk-1');
    expect(path.basename(file)).toBe(`models-${expected}.json`);
    expect(file).not.toContain('sk-1');
  });

  it('keeps separate catalogs per API key and never stores the key', async () => {
    const fn = catalogServer();
    vi.stubEnv('WAVESPEED_API_KEY', 'key-public');
    expect((await fetchModels()).models[0].model_id).toBe('only/public');
    vi.stubEnv('WAVESPEED_API_KEY', 'key-internal');
    const second = await fetchModels();
    expect(second.source).toBe('live');
    expect(second.models[0].model_id).toBe('only/internal');
    vi.stubEnv('WAVESPEED_API_KEY', 'key-public');
    const again = await fetchModels();
    expect(again.source).toBe('cache');
    expect(again.models[0].model_id).toBe('only/public');
    expect(fn).toHaveBeenCalledTimes(2);

    const dir = path.join(home, '.cache', 'wavespeed');
    const files = fs.readdirSync(dir);
    expect(files.sort()).toEqual(
      [
        path.basename(modelsCacheFile('https://api.example.test', 'key-public')),
        path.basename(modelsCacheFile('https://api.example.test', 'key-internal')),
      ].sort(),
    );
    for (const f of files) {
      const body = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(body).not.toContain('key-public');
      expect(body).not.toContain('key-internal');
      expect(Object.keys(JSON.parse(body)).sort()).toEqual(['base_url', 'fetched_at', 'models']);
    }
  });

  it('ignores the legacy shared models.json', async () => {
    const dir = path.join(home, '.cache', 'wavespeed');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'models.json'),
      JSON.stringify({ fetched_at: Date.now(), base_url: 'https://api.example.test', models: [{ model_id: 'stale/other-key' }] }),
    );
    catalogServer();
    vi.stubEnv('WAVESPEED_API_KEY', 'k');
    expect((await fetchModels()).models[0].model_id).toBe('only/k');
  });
});
