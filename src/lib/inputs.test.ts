import { describe, it, expect } from 'vitest';
import { parseInputs } from './inputs.js';

describe('parseInputs', () => {
  it('coerces primitives by syntax', () => {
    expect(
      parseInputs([
        'a=hello',
        'b=42',
        'c=3.14',
        'd=true',
        'e=false',
        'f=null',
      ]),
    ).toEqual({
      a: 'hello',
      b: 42,
      c: 3.14,
      d: true,
      e: false,
      f: null,
    });
  });

  it('parses JSON arrays and objects', () => {
    expect(parseInputs(['tags=["a","b"]'])).toEqual({ tags: ['a', 'b'] });
    expect(parseInputs(['size={"w":1,"h":2}'])).toEqual({ size: { w: 1, h: 2 } });
  });

  it('leaves invalid JSON as a literal string', () => {
    // Looks like a JSON array, but it's not valid — should stay a string.
    expect(parseInputs(['x=[not,json'])).toEqual({ x: '[not,json' });
  });

  it('nests dotted keys', () => {
    expect(
      parseInputs(['size.width=1024', 'size.height=512', 'meta.author=alice']),
    ).toEqual({
      size: { width: 1024, height: 512 },
      meta: { author: 'alice' },
    });
  });

  it('throws on missing =', () => {
    expect(() => parseInputs(['no_equal_sign'])).toThrow(/Invalid --input/);
  });

  it('returns an empty object for empty input', () => {
    expect(parseInputs([])).toEqual({});
  });
});
