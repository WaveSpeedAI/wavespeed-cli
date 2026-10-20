import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { otherInstalls } from './upgrade.js';

describe('otherInstalls', () => {
  it('reports a second wavespeed on PATH but not our own or duplicates', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-path-'));
    const a = path.join(tmp, 'a'), b = path.join(tmp, 'b'), c = path.join(tmp, 'c');
    for (const d of [a, b, c]) fs.mkdirSync(d);
    const mk = (d: string) => { const f = path.join(d, 'wavespeed'); fs.writeFileSync(f, ''); return f; };
    const mine = mk(a), other = mk(b);
    fs.symlinkSync(other, path.join(c, 'wavespeed')); // same file via symlink -> counted once
    const found = otherInstalls([a, b, c].join(path.delimiter), mine);
    expect(found).toEqual([other]);
    fs.rmSync(tmp, { recursive: true });
  });
  it('returns nothing when only our own install exists', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-path-'));
    const f = path.join(tmp, 'wavespeed'); fs.writeFileSync(f, '');
    expect(otherInstalls(tmp, f)).toEqual([]);
    fs.rmSync(tmp, { recursive: true });
  });
});
