import { describe, it, expect } from 'vitest';
import { resolveDownloadOpt, downloadOptsFromFlag } from './download-flag.js';

describe('resolveDownloadOpt', () => {
  it('treats undefined as "no download"', () => {
    expect(resolveDownloadOpt(undefined)).toEqual({ enabled: false });
  });

  it('treats bare true (commander default) as "enabled, no template"', () => {
    expect(resolveDownloadOpt(true)).toEqual({ enabled: true });
  });

  it('treats a non-empty string as "enabled with template"', () => {
    expect(resolveDownloadOpt('./out/{index}.{ext}')).toEqual({
      enabled: true,
      template: './out/{index}.{ext}',
    });
  });

  it('treats an empty string as "no download"', () => {
    expect(resolveDownloadOpt('')).toEqual({ enabled: false });
  });
});

describe('downloadOptsFromFlag', () => {
  it('returns null when the flag is absent', () => {
    expect(
      downloadOptsFromFlag(undefined, { model: 'x', prompt: 'y', outputDir: 'z' }),
    ).toBeNull();
  });

  it('passes base options when enabled without template', () => {
    expect(
      downloadOptsFromFlag(true, { model: 'x', prompt: 'y' }),
    ).toEqual({ model: 'x', prompt: 'y' });
  });

  it('forwards the template when supplied', () => {
    expect(
      downloadOptsFromFlag('./out/{index}.{ext}', { model: 'x' }),
    ).toEqual({ model: 'x', template: './out/{index}.{ext}' });
  });
});
