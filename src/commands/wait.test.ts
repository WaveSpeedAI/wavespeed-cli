import { describe, expect, it } from 'vitest';
import { parseSeconds, waitExitCode } from './wait.js';

describe('wait', () => {
  it('exit code says how the run ended', () => {
    expect(waitExitCode({ id: 'a', status: 'completed', outputs: ['https://x/y.png'] } as any, true)).toBe(0);
    expect(waitExitCode({ id: 'a', status: 'failed', error: 'nope' } as any, true)).toBe(1);
    expect(waitExitCode({ id: 'a', status: 'completed', outputs: [] } as any, true)).toBe(1); // outputs expired
    expect(waitExitCode({ id: 'a', status: 'processing' } as any, false)).toBe(2);
  });

  it('seconds must be positive numbers', () => {
    expect(parseSeconds(undefined, '--timeout')).toBeUndefined();
    expect(parseSeconds(undefined, '--interval', 3)).toBe(3);
    expect(parseSeconds('1.5', '--interval')).toBe(1.5);
    for (const bad of ['0', '-1', 'abc', '']) expect(() => parseSeconds(bad, '--timeout')).toThrow();
  });
});
