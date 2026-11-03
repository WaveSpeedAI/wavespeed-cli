import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeOutput, downloadOutputs, extFromBytes, isBase64Output } from './output.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120, 7)]);

describe('base64 outputs (enable_base64_output)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('tells naked base64 from URLs and short text', () => {
    expect(isBase64Output(PNG.toString('base64'))).toBe(true);
    expect(isBase64Output('https://cdn.example.com/a.png')).toBe(false);
    expect(isBase64Output('true')).toBe(false);
    expect(isBase64Output('A cat sitting on a mat, watercolor style, soft light and shadows')).toBe(false);
  });

  it('sniffs the extension from the decoded bytes', () => {
    expect(extFromBytes(PNG, 'bin')).toBe('png');
    expect(extFromBytes(Buffer.from('....ftypisom'), 'bin')).toBe('mp4');
    expect(extFromBytes(Buffer.from('plain'), 'bin')).toBe('bin');
  });

  it('saves a mix of base64 and URL outputs in order, fetching only the URL', async () => {
    const fetchMock = vi.fn(async () => new Response('video-bytes'));
    vi.stubGlobal('fetch', fetchMock);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-out-'));
    const saved = await downloadOutputs(
      [PNG.toString('base64'), 'https://cdn.example.com/big.mp4'],
      { template: path.join(dir, '{index}.{ext}') },
    );
    expect(saved.map((f) => path.basename(f))).toEqual(['1.png', '2.mp4']);
    expect(fs.readFileSync(saved[0]).equals(PNG)).toBe(true);
    expect(fs.readFileSync(saved[1], 'utf8')).toBe('video-bytes');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects text outputs with a clear message instead of an URL parse error', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-out-'));
    await expect(downloadOutputs(['hello world'], { outputDir: dir })).rejects.toThrow(/neither a URL nor base64/);
  });

  it('summarises inline data instead of printing it', () => {
    expect(describeOutput(PNG.toString('base64'))).toMatch(/^\(base64 data, \d+ KB\)$/);
    expect(describeOutput('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
    expect(describeOutput('hello')).toBe('hello');
  });
});
