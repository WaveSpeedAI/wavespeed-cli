import { describe, it, expect } from 'vitest';
import { detectRunHelp } from './dynamic-help.js';

// detectRunHelp scans argv for `wavespeed run <token> -h|--help` and returns
// the token. The runtime hook lives in src/cli.ts:main() and intercepts BEFORE
// commander parses, so this function must be deterministic across argv shapes.

function argv(...args: string[]): string[] {
  return ['/usr/bin/node', '/path/to/cli.js', ...args];
}

describe('detectRunHelp', () => {
  it('matches `run <model> --help`', () => {
    expect(detectRunHelp(argv('run', 'google/nano-banana-2/text-to-image', '--help'))).toBe(
      'google/nano-banana-2/text-to-image',
    );
  });

  it('matches `run <model> -h`', () => {
    expect(detectRunHelp(argv('run', 'hero', '-h'))).toBe('hero');
  });

  it('matches when -h appears before the model token', () => {
    expect(detectRunHelp(argv('run', '-h', 'google/nano-banana-2/text-to-image'))).toBe(
      'google/nano-banana-2/text-to-image',
    );
  });

  it('returns null when the first subcommand is not run', () => {
    expect(detectRunHelp(argv('schema', 'model/id', '-h'))).toBeNull();
    expect(detectRunHelp(argv('models', '-h'))).toBeNull();
  });

  it('returns null when -h/--help is absent', () => {
    expect(detectRunHelp(argv('run', 'model/id'))).toBeNull();
    expect(detectRunHelp(argv('run', 'model/id', '-p', 'cat'))).toBeNull();
  });

  it('returns null for `wavespeed run --help` (no token)', () => {
    expect(detectRunHelp(argv('run', '--help'))).toBeNull();
  });

  it('ignores other flags between run and the token', () => {
    expect(detectRunHelp(argv('run', '--json', 'foo/bar', '-h'))).toBe('foo/bar');
  });
});
