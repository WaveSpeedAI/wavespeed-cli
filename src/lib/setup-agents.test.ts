import { describe, expect, it } from 'vitest';
import {
  aiderValues, applyCodexToml, applyContinueYaml, applyDshPatch, applyGeminiEnv, revertGeminiEnv, geminiEdits, applyHermesYaml, applyJson, applyYamlScalars, claudeEdits, crushEdits, droidEdits, gooseProviderFile, goosePlainValues, miniAgentValues, openclawEdits, opencodeEdits, qwenEdits, revertCodexToml, revertContinueYaml, revertDshPatch, revertHermesYaml, revertJson, revertYamlScalars, validateModel,
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

describe('crush / droid', () => {
  it('crush adds the provider and both model slots, and reverts', () => {
    const original: any = { options: { disable_metrics: true }, providers: { other: { type: 'openai' } } };
    const doc = structuredClone(original);
    const { previous } = applyJson(doc, crushEdits('a/b'));
    expect(doc.providers.wavespeed).toMatchObject({ type: 'openai-compat', base_url: 'https://llm.wavespeed.ai/v1', api_key: '$WAVESPEED_API_KEY' });
    expect(doc.models.large).toEqual({ provider: 'wavespeed', model: 'a/b' });
    revertJson(doc, previous);
    expect(doc).toEqual(original);
  });
  it('droid replaces only its own customModels entry', () => {
    const original: any = { customModels: [{ model: 'x', baseUrl: 'https://other/v1', provider: 'openai' }], other: 1 };
    const doc = structuredClone(original);
    const { previous } = applyJson(doc, droidEdits('a/b', doc));
    expect(doc.sessionDefaultSettings.model).toBe('custom:a/b');
    expect(doc.customModels).toHaveLength(2);
    expect(doc.customModels[1]).toMatchObject({ model: 'a/b', baseUrl: 'https://llm.wavespeed.ai/v1', apiKey: '${WAVESPEED_API_KEY}', provider: 'generic-chat-completion-api' });
    // the saved undo state must not contain the user's other entries
    expect(JSON.stringify(previous)).not.toContain('https://other/v1');
    const again = structuredClone(doc);
    applyJson(again, droidEdits('c/d', again));
    expect(again.customModels.map((e: any) => e.model)).toEqual(['x', 'c/d']);
    expect(again.sessionDefaultSettings.model).toBe('custom:c/d');
    revertJson(doc, previous);
    expect(doc).toEqual(original);
  });
});

describe('aider / goose values', () => {
  it('aider prefixes the model for litellm and keeps the key in the file', () => {
    expect(aiderValues('a/b', 'sk')).toEqual({ 'openai-api-base': 'https://llm.wavespeed.ai/v1', 'openai-api-key': 'sk', model: 'openai/a/b' });
  });
  it('goose provider file reads the key from the environment', () => {
    const f = JSON.parse(gooseProviderFile('a/b'));
    expect(f).toMatchObject({ name: 'wavespeed', engine: 'openai', api_key_env: 'WAVESPEED_API_KEY', base_url: 'https://llm.wavespeed.ai/v1/chat/completions' });
    expect(f.models[0].name).toBe('a/b');
    expect(goosePlainValues('a/b')).toEqual({ GOOSE_PROVIDER: 'wavespeed', GOOSE_MODEL: 'a/b' });
  });
});

describe('continue yaml', () => {
  const user = '# mine\nname: Mine\nversion: 1.0.0\nschema: v1\nmodels:\n  - name: Other\n    provider: anthropic\n    model: claude\n\nrules:\n  - be nice\n';
  it('appends an entry, keeps everything else, and reverts byte-exact', () => {
    const { text, previous } = applyContinueYaml(user, 'a/b');
    expect(text).toContain('# mine');
    expect(text).toContain('  - name: "WaveSpeed a/b"');
    // ours is the first list entry, ahead of the user's own
    expect(text.indexOf('WaveSpeed a/b')).toBeLessThan(text.indexOf('name: Other'));
    expect(text).toContain('apiKey: "${{ secrets.WAVESPEED_API_KEY }}"');
    expect(text).toContain('rules:\n  - be nice');
    expect(revertContinueYaml(text, JSON.parse(JSON.stringify(previous)))).toBe(user);
  });
  it('replaces its own entry when run again', () => {
    const one = applyContinueYaml(user, 'a/b');
    const two = applyContinueYaml(one.text, 'c/d');
    expect(two.text.match(/apiBase:/g)).toHaveLength(1);
    expect(two.text).toContain('model: "c/d"');
    expect(revertContinueYaml(two.text, two.previous)).toContain('name: Other');
  });
  it('creates a whole file and removes it again', () => {
    const { text, previous } = applyContinueYaml('', 'a/b');
    expect(text.startsWith('name: WaveSpeed\nversion: 1.0.0\nschema: v1\nmodels:\n')).toBe(true);
    expect(revertContinueYaml(text, previous)).toBe('');
  });
  it('adds a models list to a file that has none', () => {
    const base = 'name: X\nversion: 1.0.0\nschema: v1\n';
    const { text, previous } = applyContinueYaml(base, 'a/b');
    expect(revertContinueYaml(text, JSON.parse(JSON.stringify(previous)))).toBe(base);
  });
  it('refuses a flow-style list', () => {
    expect(() => applyContinueYaml('models: []\n', 'a/b')).toThrow();
  });
});

describe('dsh patch', () => {
  it('writes the block into a missing or empty list and reverts to an empty list', () => {
    const out = applyDshPatch('# header\n[]\n', 'a/b');
    expect(out).toContain('- id: llm-pi-ai');
    expect(out).toContain('apiKeyEnv: WAVESPEED_API_KEY');
    expect(out).toContain('provider: wavespeed');
    expect(out).not.toMatch(/^\[\]$/m);
    expect(revertDshPatch(out)).toBe('# header\n[]\n');
    expect(revertDshPatch(applyDshPatch('', 'a/b'))).toBe('[]\n');
  });
  it('appends after the user entries and keeps them', () => {
    const user = '- id: other\n  config:\n    x: 1\n';
    const out = applyDshPatch(user, 'a/b');
    expect(out.startsWith(user)).toBe(true);
    expect(revertDshPatch(out)).toBe(user);
  });
  it('is idempotent and refuses a hand-written patch of the same plugins', () => {
    const once = applyDshPatch('[]\n', 'a/b');
    expect(applyDshPatch(once, 'c/d').match(/- id: llm-pi-ai/g)).toHaveLength(1);
    expect(() => applyDshPatch('- id: llm-pi-ai\n  config: {}\n', 'a/b')).toThrow();
  });
});

describe('gemini', () => {
  it('appends a managed env block and reverts to the original bytes', () => {
    const user = '# mine\nFOO=bar\n';
    const out = applyGeminiEnv(user, 'wsk_live_x');
    expect(out.startsWith(user)).toBe(true);
    expect(out).toContain('GOOGLE_GEMINI_BASE_URL=https://llm.wavespeed.ai\n');
    expect(out).toContain('GEMINI_API_KEY=wsk_live_x\n');
    expect(revertGeminiEnv(out)).toBe(user);
    expect(revertGeminiEnv(applyGeminiEnv('', 'k'))).toBe('');
  });
  it('is idempotent and rejects a key with a line break', () => {
    const once = applyGeminiEnv('A=1\n', 'k1');
    expect(applyGeminiEnv(once, 'k2').match(/GEMINI_API_KEY=/g)).toHaveLength(1);
    expect(() => applyGeminiEnv('', 'a\nb')).toThrow();
  });
  it('selects api-key auth and the model in settings.json', () => {
    expect(geminiEdits('a/b')).toEqual([
      { path: ['security', 'auth', 'selectedType'], value: 'gemini-api-key' },
      { path: ['model', 'name'], value: 'a/b' },
    ]);
  });
});
