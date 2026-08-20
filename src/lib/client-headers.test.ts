import { describe, it, expect, afterEach } from 'vitest';
import {
  CLI_CLIENT_NAME,
  resolveClientName,
  clientAttributionHeaders,
} from './client-headers.js';

const ORIGINAL_ENV = process.env.WAVESPEED_CLIENT_NAME;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.WAVESPEED_CLIENT_NAME;
  } else {
    process.env.WAVESPEED_CLIENT_NAME = ORIGINAL_ENV;
  }
});

describe('clientAttributionHeaders', () => {
  it('reports the CLI name, package version, and OS', () => {
    delete process.env.WAVESPEED_CLIENT_NAME;
    const headers = clientAttributionHeaders();
    expect(headers['X-Client-Name']).toBe(CLI_CLIENT_NAME);
    expect(headers['X-Client-Version']).toMatch(/^\d+\.\d+\.\d+/);
    expect(['darwin', 'linux', 'windows']).toContain(headers['X-Client-OS']);
  });

  it('lets WAVESPEED_CLIENT_NAME override the client name', () => {
    process.env.WAVESPEED_CLIENT_NAME = 'dsh-skill';
    expect(resolveClientName()).toBe('dsh-skill');
    expect(clientAttributionHeaders()['X-Client-Name']).toBe('dsh-skill');
  });
});
