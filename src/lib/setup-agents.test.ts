import { describe, expect, it } from 'vitest';
import {
  applyCodexToml, applyJson, claudeEdits, opencodeEdits, revertCodexToml, revertJson, validateModel,
} from './setup-agents.js';

describe('applyJson / revertJson', () => {
  it('round-trips an existing config without losing other settings', () => {
    const original = { theme: 'dark', env: { FOO: '1', ANTHROPIC_MODEL: 'old' } };
    const doc = structuredClone(original);
    const { previous } = applyJson(doc, claudeEdits('m/x', 'sk'));
    expect((doc.env as any).ANTHROPIC_MODEL).toBe('m/x');
    expect((doc.env as any).ANTHROPIC_AUTH_TOKEN).toBe('sk');
    expect((doc.env as any).FOO).toBe('1');
    expect(revertJson(doc, previous)).toEqual(original);
  });
  it('removes containers it created', () => {
    const doc: any = {};
    const { previous } = applyJson(doc, opencodeEdits('m/x'));
    expect(doc.provider.wavespeed.options.apiKey).toBe('{env:WAVESPEED_API_KEY}');
    expect(doc.model).toBe('wavespeed/m/x');
    expect(revertJson(doc, previous)).toEqual({});
  });
  it('restores a previous opencode model and keeps other providers', () => {
    const doc: any = { model: 'anthropic/claude', provider: { other: { a: 1 } } };
    const { previous } = applyJson(doc, opencodeEdits('m/x'));
    revertJson(doc, previous);
    expect(doc).toEqual({ model: 'anthropic/claude', provider: { other: { a: 1 } } });
  });
});

describe('codex toml', () => {
  const user = '# my settings\nmodel = "gpt-5"\nmodel_provider = "openai"\napproval_policy = "never"\n\n[projects."/x"]\ntrust_level = "trusted"\n';
  it('replaces top-level model keys, adds provider, and reverts exactly', () => {
    const out = applyCodexToml(user, 'a/b');
    expect(out).toContain('model = "a/b"');
    expect(out).toContain('[model_providers.wavespeed]');
    expect(out).toContain('wire_api = "responses"');
    expect(out).toContain('approval_policy = "never"');
    expect(out).toContain('# my settings');
    // the user's old model lines must not remain active (duplicate keys are invalid TOML)
    expect(out.split('\n').filter((l) => /^model\s*=/.test(l))).toHaveLength(1);
    expect(revertCodexToml(out)).toBe(user);
  });
  it('is idempotent when re-applied with a new model', () => {
    const once = applyCodexToml(user, 'a/b');
    const twice = applyCodexToml(once, 'c/d');
    expect(twice).toContain('model = "c/d"');
    expect(twice).not.toContain('a/b');
    expect(twice.match(/\[model_providers\.wavespeed\]/g)).toHaveLength(1);
    expect(revertCodexToml(twice)).toBe(user);
  });
  it('does not touch model keys inside tables', () => {
    const t = '[profiles.x]\nmodel = "keep"\n';
    expect(applyCodexToml(t, 'a/b')).toContain('model = "keep"');
  });
  it('works on an empty file', () => {
    expect(revertCodexToml(applyCodexToml('', 'a/b')).trim()).toBe('');
  });
  it('refuses a hand-written wavespeed provider', () => {
    expect(() => applyCodexToml('[model_providers.wavespeed]\nname="x"\n', 'a/b')).toThrow();
  });
});

describe('validateModel', () => {
  it('rejects values that could break out of a config string', () => {
    expect(() => validateModel('a"b')).toThrow();
    expect(() => validateModel('a b')).toThrow();
    expect(() => validateModel('')).toThrow();
  });
  it('accepts normal ids', () => {
    expect(validateModel('deepseek/deepseek-v4.1-flash-1017')).toBe('deepseek/deepseek-v4.1-flash-1017');
  });
});
