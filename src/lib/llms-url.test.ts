import { describe, it, expect } from 'vitest';
import { modelLlmsTxtUrl } from './api.js';

describe('modelLlmsTxtUrl', () => {
  it('points at the model page markdown, keeping every path segment', () => {
    expect(modelLlmsTxtUrl('bytedance/seedance-2.5/image-to-video')).toBe(
      'https://wavespeed.ai/models/bytedance/seedance-2.5/image-to-video/llms.txt',
    );
  });
});
