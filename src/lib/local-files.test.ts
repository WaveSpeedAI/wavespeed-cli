import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { collectLocalFiles, resolveLocalFiles } from './local-files.js';

const onDisk = (...paths: string[]) => (p: string) => paths.includes(p);

describe('collectLocalFiles', () => {
  it('picks up an existing media path', () => {
    expect(collectLocalFiles({ image: './cat.png' }, { exists: onDisk('./cat.png') })).toEqual([
      { path: './cat.png', at: 'image', explicit: false },
    ]);
  });

  it('leaves URLs alone', () => {
    const input = {
      a: 'https://cdn.example.test/cat.png',
      b: 'http://example.test/cat.png',
      c: 'data:image/png;base64,AAAA',
    };
    expect(collectLocalFiles(input, { exists: () => true })).toEqual([]);
  });

  // The whole point of the extension + existence pair: a value that merely
  // looks like a filename must not turn into an upload.
  it('ignores a media path that is not on disk', () => {
    expect(collectLocalFiles({ image: './cat.png' }, { exists: () => false })).toEqual([]);
  });

  it('ignores an existing file with a non-media extension', () => {
    expect(collectLocalFiles({ seed: '1.txt' }, { exists: onDisk('1.txt') })).toEqual([]);
  });

  it('does not auto-detect inside free-text fields', () => {
    const input = { prompt: 'cat.png', negative_prompt: 'blur.jpg' };
    expect(collectLocalFiles(input, { exists: () => true })).toEqual([]);
  });

  it('honours @ in free-text fields and for any extension', () => {
    expect(collectLocalFiles({ prompt: '@notes.txt' }, { exists: () => false })).toEqual([
      { path: 'notes.txt', at: 'prompt', explicit: true },
    ]);
  });

  it('walks arrays and nested objects', () => {
    const input = {
      image_urls: ['a.png', 'https://example.test/b.png', 'c.png'],
      opts: { mask: 'm.webp' },
    };
    expect(collectLocalFiles(input, { exists: onDisk('a.png', 'c.png', 'm.webp') })).toEqual([
      { path: 'a.png', at: 'image_urls.0', explicit: false },
      { path: 'c.png', at: 'image_urls.2', explicit: false },
      { path: 'm.webp', at: 'opts.mask', explicit: false },
    ]);
  });

  // An array element must be judged by its container's field name, otherwise
  // `prompt: ['cat.png']` would auto-detect where `prompt: 'cat.png'` does not.
  it('applies the free-text exclusion to array elements too', () => {
    expect(collectLocalFiles({ prompt: ['cat.png'] }, { exists: () => true })).toEqual([]);
  });
});

describe('resolveLocalFiles', () => {
  it('replaces paths with uploaded URLs without mutating the input', async () => {
    const input = { image: 'a.png', mask: 'b.png' };
    const upload = vi.fn(async (p: string) => `https://cdn.test/${path.basename(p)}`);

    const { input: out, uploaded } = await resolveLocalFiles(input, {
      exists: onDisk('a.png', 'b.png'),
      upload,
    });

    expect(out).toEqual({ image: 'https://cdn.test/a.png', mask: 'https://cdn.test/b.png' });
    expect(input).toEqual({ image: 'a.png', mask: 'b.png' });
    expect(uploaded).toBe(2);
  });

  it('uploads a repeated file once', async () => {
    const upload = vi.fn(async () => 'https://cdn.test/a.png');
    const { uploaded } = await resolveLocalFiles(
      { image: 'a.png', reference: './a.png' },
      { exists: onDisk('a.png', './a.png'), upload },
    );
    expect(upload).toHaveBeenCalledTimes(1);
    expect(uploaded).toBe(1);
  });

  it('fails loudly when an @ path is missing', async () => {
    await expect(
      resolveLocalFiles({ image: '@nope.png' }, { exists: () => false, upload: async () => 'x' }),
    ).rejects.toThrow(/File not found: nope\.png/);
  });

  it('is a no-op when there is nothing local', async () => {
    const upload = vi.fn();
    const input = { prompt: 'a cat', image: 'https://example.test/a.png' };
    const { input: out, uploaded } = await resolveLocalFiles(input, {
      exists: () => true,
      upload,
    });
    expect(out).toBe(input);
    expect(uploaded).toBe(0);
    expect(upload).not.toHaveBeenCalled();
  });
});
