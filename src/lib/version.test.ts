import { describe, expect, it } from 'vitest';
import { assetName, isNewer } from './version.js';

describe('isNewer', () => {
  it('compares numerically, not lexically', () => {
    expect(isNewer('0.4.15', '0.4.14')).toBe(true);
    expect(isNewer('0.10.0', '0.9.9')).toBe(true);
    expect(isNewer('1.0.0', '0.99.99')).toBe(true);
  });
  it('is false for equal or older', () => {
    expect(isNewer('0.4.14', '0.4.14')).toBe(false);
    expect(isNewer('0.4.13', '0.4.14')).toBe(false);
    expect(isNewer('0.9.9', '0.10.0')).toBe(false);
  });
  it('tolerates v prefix and prerelease tails', () => {
    expect(isNewer('v0.5.0', '0.4.14')).toBe(true);
    expect(isNewer('0.5.0-beta.1', '0.4.14')).toBe(true);
  });
  it('never claims an upgrade for unparseable versions', () => {
    expect(isNewer('latest', '0.4.14')).toBe(false);
    expect(isNewer('0.4.15', 'dev')).toBe(false);
  });
});

describe('assetName', () => {
  it('names release assets per platform', () => {
    expect(assetName('linux', 'x64')).toBe('wavespeed-linux-x64');
    expect(assetName('darwin', 'arm64')).toBe('wavespeed-darwin-arm64');
    expect(assetName('win32', 'x64')).toBe('wavespeed-windows-x64.exe');
  });
});
