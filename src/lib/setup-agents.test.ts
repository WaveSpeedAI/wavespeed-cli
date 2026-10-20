import { describe, expect, it } from 'vitest';
import {
  applyCodexToml, applyHermesYaml, applyJson, applyYamlScalars, claudeEdits, miniAgentValues, openclawEdits, opencodeEdits, qwenEdits, revertCodexToml, revertHermesYaml, revertJson, revertYamlScalars, validateModel,
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

describe('openclaw', () => {
  it('adds the provider and round-trips, preserving other providers', () => {
    const original: any = { models: { providers: { other: { baseUrl: 'x' } } }, agents: { defaults: { model: { primary: 'other/m' } } } };
    const doc = structuredClone(original);
    const { previous } = applyJson(doc, openclawEdits('a/b', doc));
    expect(doc.models.providers.wavespeed.api).toBe('openai-completions');
    expect(doc.models.providers.wavespeed.apiKey).toBe('${WAVESPEED_API_KEY}');
    expect(doc.agents.defaults.model.primary).toBe('wavespeed/a/b');
    expect(doc.models.providers.other).toEqual({ baseUrl: 'x' });
    revertJson(doc, previous);
    expect(doc.models.providers).toEqual(original.models.providers);
    expect(doc.agents.defaults.model.primary).toBe('other/m');
  });
  it('extends an existing model allowlist, and only then', () => {
    const withList: any = { agents: { defaults: { models: { 'x/y': {} } } } };
    const edits = openclawEdits('a/b', withList);
    applyJson(withList, edits);
    expect(withList.agents.defaults.models['wavespeed/a/b']).toEqual({});
    expect(openclawEdits('a/b', {}).some((e) => e.path.includes('models') && e.path[1] === 'defaults' && e.path[2] === 'models')).toBe(false);
  });
});

describe('hermes yaml', () => {
  const user = '# my hermes\nmodel:\n  default: "gpt-5"  # keep me\n  provider: openai\n\n# providers\ncustom_providers:\n  - name: other\n    base_url: http://x\n\nother: 1\n';
  it('edits in place: only the touched lines change, and reverts byte-exact', () => {
    const { text, previous } = applyHermesYaml(user, 'a/b');
    expect(text).toContain('default: "a/b"  # keep me');
    expect(text).toContain('provider: "wavespeed"');
    expect(text).toContain('# my hermes');
    expect(text).toContain('# providers');
    expect(text).toContain('  - name: other\n    base_url: http://x\n  - name: wavespeed\n');
    expect(text).toContain('key_env: WAVESPEED_API_KEY');
    expect(text.split('\n').length - user.split('\n').length).toBe(4);
    expect(revertHermesYaml(text, previous)).toBe(user);
  });
  it('is idempotent and still reverts to the original', () => {
    const one = applyHermesYaml(user, 'a/b');
    const two = applyHermesYaml(one.text, 'c/d');
    expect(two.text.match(/name: wavespeed/g)).toHaveLength(1);
    expect(two.text).toContain('default: "c/d"');
    // second apply recorded the already-modified values; reverting both steps restores the original
    expect(revertHermesYaml(revertHermesYaml(two.text, two.previous), one.previous)).toBe(user);
  });
  it('adds missing keys, a missing block, and a missing list', () => {
    const a = applyHermesYaml('model:\n  temperature: 1\n', 'a/b');
    expect(a.text).toContain('  default: "a/b"');
    expect(revertHermesYaml(a.text, a.previous)).toBe('model:\n  temperature: 1\n');
    const b = applyHermesYaml('foo: 1\n', 'a/b');
    expect(b.text).toContain('model:\n  default: "a/b"\n  provider: "wavespeed"\n');
    expect(revertHermesYaml(b.text, b.previous)).toBe('foo: 1\n');
  });
  it('works on an empty file', () => {
    const { text, previous } = applyHermesYaml('', 'a/b');
    expect(text).toContain('custom_providers:');
    expect(revertHermesYaml(text, previous)).toBe('');
  });
  it('refuses input it cannot edit safely', () => {
    expect(() => applyHermesYaml('a: [1, 2', 'a/b')).toThrow();
    expect(() => applyHermesYaml('model: gpt-5\n', 'a/b')).toThrow();
    expect(() => applyHermesYaml('model:\n  default: x\ncustom_providers: []\n', 'a/b')).toThrow();
  });
});

describe('qwen', () => {
  it('adds the provider and round-trips', () => {
    const original: any = { model: { name: 'qwen3' }, security: { auth: { selectedType: 'qwen-oauth' } }, modelProviders: { openai: [{ id: 'x' }] } };
    const doc = structuredClone(original);
    const { previous } = applyJson(doc, qwenEdits('a/b'));
    expect(doc.modelProviders.wavespeed[0]).toMatchObject({ id: 'a/b', envKey: 'WAVESPEED_API_KEY', baseUrl: 'https://llm.wavespeed.ai/v1' });
    expect(doc.providerProtocol.wavespeed).toBe('openai');
    expect(doc.security.auth.selectedType).toBe('openai');
    revertJson(doc, previous);
    expect(doc).toEqual(original);
  });
});

describe('mini-agent yaml scalars', () => {
  const vals = miniAgentValues('a/b', 'sk-1');
  it('creates a minimal config and reverts to nothing', () => {
    const { text, previous } = applyYamlScalars('', vals);
    expect(text).toBe('api_key: "sk-1"\napi_base: "https://llm.wavespeed.ai/v1"\nmodel: "a/b"\nprovider: "openai"\n');
    expect(revertYamlScalars(text, previous)).toBe('');
  });
  it('edits existing values in place and reverts byte-exact', () => {
    const user = '# my config\napi_key: "YOUR_API_KEY_HERE"\napi_base: "https://api.minimax.io"  # global\nmodel: "MiniMax-M2.5"\nretry:\n  enabled: true\n';
    const { text, previous } = applyYamlScalars(user, vals);
    expect(text).toContain('# my config');
    expect(text).toContain('api_base: "https://llm.wavespeed.ai/v1"  # global');
    expect(text).toContain('retry:\n  enabled: true');
    expect(text.trimEnd().endsWith('provider: "openai"')).toBe(true);
    expect(revertYamlScalars(text, previous)).toBe(user);
  });
  it('survives the JSON round trip the saved state goes through', () => {
    const user = 'api_key: "x"\nmax_steps: 20\n';
    const { text, previous } = applyYamlScalars(user, vals);
    expect(revertYamlScalars(text, JSON.parse(JSON.stringify(previous)))).toBe(user);
  });
});
