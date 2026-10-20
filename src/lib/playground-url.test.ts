import { describe, it, expect } from 'vitest';
import { modelPlaygroundUrl } from './api.js';

describe('modelPlaygroundUrl', () => {
  it('links the model page, keeping every path segment', () => {
    expect(modelPlaygroundUrl('google/nano-banana-2.1/edit')).toBe(
      'https://wavespeed.ai/models/google/nano-banana-2.1/edit',
    );
  });
});
