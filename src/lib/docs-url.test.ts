import { describe, it, expect } from 'vitest';
import { modelDocsUrl } from './api.js';

describe('modelDocsUrl', () => {
  it('links the docs page, dropping the wavespeed-ai prefix and joining the rest with dashes', () => {
    expect(modelDocsUrl('google/nano-banana-2.1/edit')).toBe(
      'https://wavespeed.ai/docs/docs-api/google/google-nano-banana-2.1-edit',
    );
    expect(modelDocsUrl('wavespeed-ai/infinitetalk/multi')).toBe(
      'https://wavespeed.ai/docs/docs-api/wavespeed-ai/infinitetalk-multi',
    );
  });
});
