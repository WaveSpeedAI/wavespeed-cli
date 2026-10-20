// Pure helpers for `wavespeed setup`: build and revert the config edits for each
// coding agent. No file or network access here, so everything is unit-testable.
// Endpoint/protocol choices mirror api-dashboard/app/[locale]/llm/agents/data.ts.

export const LLM_BASE_URL = 'https://llm.wavespeed.ai/v1';
export const CLAUDE_BASE_URL = 'https://llm.wavespeed.ai';
export const DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash-1017';
export const KEY_ENV = 'WAVESPEED_API_KEY';

const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;

export function validateModel(model: string): string {
  if (!MODEL_PATTERN.test(model)) {
    throw new Error('Model may only contain letters, numbers, _ . / : - (max 256 characters)');
  }
  return model;
}

import { parseDocument } from 'yaml';

// ---------- JSON agents (Claude Code, OpenCode, OpenClaw) ----------

export interface JsonEdit {
  path: string[];
  value: unknown;
}

export interface JsonPrevious {
  path: string[];
  existed: boolean;
  value?: unknown;
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Set each path, remembering what was there so `revertJson` can put it back. */
export function applyJson(doc: Obj, edits: JsonEdit[]): { doc: Obj; previous: JsonPrevious[] } {
  const previous: JsonPrevious[] = [];
  for (const { path, value } of edits) {
    let cur = doc;
    for (const key of path.slice(0, -1)) {
      if (!isObj(cur[key])) cur[key] = {};
      cur = cur[key] as Obj;
    }
    const last = path[path.length - 1];
    const existed = Object.prototype.hasOwnProperty.call(cur, last);
    previous.push({ path, existed, value: existed ? cur[last] : undefined });
    cur[last] = value;
  }
  return { doc, previous };
}

export function revertJson(doc: Obj, previous: JsonPrevious[]): Obj {
  for (const { path, existed, value } of [...previous].reverse()) {
    const parents: Obj[] = [doc];
    let cur: unknown = doc;
    for (const key of path.slice(0, -1)) {
      cur = isObj(cur) ? cur[key] : undefined;
      if (!isObj(cur)) break;
      parents.push(cur);
    }
    if (parents.length !== path.length) continue; // structure changed since setup; leave it
    const holder = parents[parents.length - 1];
    const last = path[path.length - 1];
    if (existed) holder[last] = value;
    else delete holder[last];
    // Drop containers we created and that are now empty.
    for (let i = parents.length - 1; i > 0; i--) {
      if (Object.keys(parents[i]).length === 0) delete parents[i - 1][path[i - 1]];
      else break;
    }
  }
  return doc;
}

export function claudeEdits(model: string, apiKey: string): JsonEdit[] {
  const m = validateModel(model);
  return [
    ['ANTHROPIC_AUTH_TOKEN', apiKey],
    ['ANTHROPIC_BASE_URL', CLAUDE_BASE_URL],
    ['ANTHROPIC_MODEL', m],
    ['ANTHROPIC_DEFAULT_OPUS_MODEL', m],
    ['ANTHROPIC_DEFAULT_SONNET_MODEL', m],
    ['ANTHROPIC_DEFAULT_HAIKU_MODEL', m],
  ].map(([k, v]) => ({ path: ['env', k], value: v }));
}

export function opencodeEdits(model: string): JsonEdit[] {
  const m = validateModel(model);
  return [
    {
      path: ['provider', 'wavespeed'],
      value: {
        npm: '@ai-sdk/openai-compatible',
        name: 'WaveSpeedAI',
        options: { baseURL: LLM_BASE_URL, apiKey: `{env:${KEY_ENV}}` },
        models: { [m]: { name: m, tool_call: true } },
      },
    },
    { path: ['model'], value: `wavespeed/${m}` },
  ];
}

export function openclawEdits(model: string, doc: Obj): JsonEdit[] {
  const m = validateModel(model);
  const edits: JsonEdit[] = [
    { path: ['agents', 'defaults', 'model', 'primary'], value: `wavespeed/${m}` },
    { path: ['models', 'mode'], value: 'merge' },
    {
      path: ['models', 'providers', 'wavespeed'],
      value: {
        baseUrl: LLM_BASE_URL,
        apiKey: `\${${KEY_ENV}}`,
        api: 'openai-completions',
        models: [{ id: m, name: m, contextWindow: 200000, maxTokens: 32000 }],
      },
    },
  ];
  // A user-maintained model allowlist would otherwise reject the new model.
  const agents = doc.agents as Obj | undefined;
  const defaults = agents?.defaults as Obj | undefined;
  if (isObj(defaults?.models)) edits.push({ path: ['agents', 'defaults', 'models', `wavespeed/${m}`], value: {} });
  return edits;
}

export function qwenEdits(model: string): JsonEdit[] {
  const m = validateModel(model);
  return [
    { path: ['modelProviders', 'wavespeed'], value: [{ id: m, name: m, envKey: KEY_ENV, baseUrl: LLM_BASE_URL }] },
    { path: ['providerProtocol', 'wavespeed'], value: 'openai' },
    { path: ['security', 'auth', 'selectedType'], value: 'openai' },
    { path: ['model', 'name'], value: m },
  ];
}

// ---------- Mini-Agent (flat YAML scalars; the key lives in the file) ----------

export function miniAgentValues(model: string, apiKey: string): Record<string, string> {
  return { api_key: apiKey, api_base: LLM_BASE_URL, model: validateModel(model), provider: 'openai' };
}

/** Set top-level `key: "value"` pairs in place. Returns the raw text each key held before (null = absent). */
export function applyYamlScalars(input: string, values: Record<string, string>): { text: string; previous: Record<string, string | null> } {
  let text = input;
  if (text !== '' && !text.endsWith('\n')) text += '\n';
  const doc = parseDocument(text);
  if (doc.errors.length) throw new Error(`config.yaml is not valid YAML: ${doc.errors[0].message}`);
  const root = doc.contents as { get?: (k: string, keep?: boolean) => any } | null;
  // null (not undefined) marks "absent": the state is stored as JSON, which drops undefined values.
  const previous: Record<string, string | null> = {};
  const edits: { start: number; end: number; text: string }[] = [];
  let tail = '';
  for (const [key, value] of Object.entries(values)) {
    const node = root?.get?.(key, true);
    const quoted = JSON.stringify(value);
    if (node?.range) {
      previous[key] = text.slice(node.range[0], node.range[1]);
      edits.push({ start: node.range[0], end: node.range[1], text: quoted });
    } else {
      previous[key] = null;
      tail += `${key}: ${quoted}\n`;
    }
  }
  return { text: [...edits].sort((a, b) => b.start - a.start).reduce((t, e) => t.slice(0, e.start) + e.text + t.slice(e.end), text) + tail, previous };
}

export function revertYamlScalars(input: string, previous: Record<string, string | null>): string {
  let text = input;
  const doc = parseDocument(text);
  const root = doc.contents as { get?: (k: string, keep?: boolean) => any; items?: any[] } | null;
  const edits: { start: number; end: number; text: string }[] = [];
  for (const [key, raw] of Object.entries(previous)) {
    const node = root?.get?.(key, true);
    if (!node?.range) continue;
    if (raw !== null) {
      edits.push({ start: node.range[0], end: node.range[1], text: raw });
    } else {
      const pair = root!.items!.find((p: any) => p.key?.value === key);
      const ks = pair.key.range[0] as number;
      edits.push({ start: lineStart(text, ks), end: lineEnd(text, node.range[1]), text: '' });
    }
  }
  return [...edits].sort((a, b) => b.start - a.start).reduce((t, e) => t.slice(0, e.start) + e.text + t.slice(e.end), text);
}

// ---------- Hermes (YAML, edited in place so a large commented config keeps its layout) ----------

export interface HermesPrevious {
  hadModelBlock: boolean;
  /** Raw source text of the scalar we replaced, or undefined when the key did not exist. */
  defaultRaw?: string;
  providerRaw?: string;
  hadList: boolean;
  /** Source text of a pre-existing wavespeed entry that we replaced. */
  entryRaw?: string;
}

const lineStart = (t: string, off: number) => t.lastIndexOf('\n', off - 1) + 1;
const lineEnd = (t: string, off: number) => {
  const i = t.indexOf('\n', off);
  return i < 0 ? t.length : i + 1;
};

/** End of the line holding the last real character before `off` (a node's range can run over trailing blank lines). */
const contentLineEnd = (t: string, off: number) => lineEnd(t, t.slice(0, off).trimEnd().length - 1);

interface TextEdit { start: number; end: number; text: string }

function applyEdits(text: string, edits: TextEdit[]): string {
  return [...edits].sort((x, y) => y.start - x.start).reduce((t, e) => t.slice(0, e.start) + e.text + t.slice(e.end), text);
}

function entryLines(pad: string): string {
  return [
    `${pad}- name: wavespeed`,
    `${pad}  base_url: ${LLM_BASE_URL}`,
    `${pad}  key_env: ${KEY_ENV}`,
    `${pad}  api_mode: chat_completions`,
    '',
  ].join('\n');
}

type YNode = { range?: [number, number, number] | null; value?: unknown; items?: any[]; flow?: boolean; get?: (k: string, keep?: boolean) => any };

function dashPad(text: string, itemStart: number): { dash: number; pad: string } {
  const dash = text.lastIndexOf('-', itemStart - 1);
  return { dash, pad: ' '.repeat(dash - lineStart(text, dash)) };
}

function parseYaml(text: string) {
  const doc = parseDocument(text);
  if (doc.errors.length) throw new Error(`config.yaml is not valid YAML: ${doc.errors[0].message}`);
  return doc;
}

export function applyHermesYaml(input: string, model: string): { text: string; previous: HermesPrevious } {
  const m = validateModel(model);
  let text = input;
  if (text !== '' && !text.endsWith('\n')) text += '\n';
  const doc = parseYaml(text);
  const edits: TextEdit[] = [];
  let tail = '';
  const previous: HermesPrevious = { hadModelBlock: false, hadList: false };
  const want = { default: JSON.stringify(m), provider: '"wavespeed"' } as const;

  const root = doc.contents as YNode | null;
  const modelNode = root?.get?.('model', true) as YNode | undefined;
  if (modelNode === undefined || modelNode === null) {
    tail += `model:\n  default: ${want.default}\n  provider: ${want.provider}\n`;
  } else if (modelNode.items) {
    previous.hadModelBlock = true;
    const missing: string[] = [];
    for (const key of ['default', 'provider'] as const) {
      const v = modelNode.get?.(key, true) as YNode | undefined;
      if (v && v.range) {
        const raw = text.slice(v.range[0], v.range[1]);
        if (key === 'default') previous.defaultRaw = raw; else previous.providerRaw = raw;
        edits.push({ start: v.range[0], end: v.range[1], text: want[key] });
      } else {
        missing.push(key);
      }
    }
    if (missing.length) {
      const first = modelNode.items[0]?.key?.range?.[0] as number | undefined;
      if (first === undefined) throw new Error('model: block in config.yaml is empty or inline; edit it by hand');
      const pad = ' '.repeat(first - lineStart(text, first));
      edits.push({ start: lineStart(text, first), end: lineStart(text, first), text: missing.map((k) => `${pad}${k}: ${want[k as 'default']}\n`).join('') });
    }
  } else {
    throw new Error('model: in config.yaml is not a block; edit it by hand');
  }

  const list = root?.get?.('custom_providers', true) as YNode | undefined;
  if (list === undefined || list === null) {
    tail += `custom_providers:\n${entryLines('  ')}`;
  } else if (list.items && list.flow !== true) {
    previous.hadList = true;
    const mine = list.items.find((it: any) => it?.get?.('name') === 'wavespeed');
    if (mine?.range) {
      const { dash, pad } = dashPad(text, mine.range[0]);
      const end = contentLineEnd(text, mine.range[1]);
      previous.entryRaw = text.slice(lineStart(text, dash), end);
      edits.push({ start: lineStart(text, dash), end, text: entryLines(pad) });
    } else if (list.items.length > 0) {
      const last = list.items[list.items.length - 1];
      const { pad } = dashPad(text, list.items[0].range[0]);
      const at = contentLineEnd(text, last.range[1]);
      edits.push({ start: at, end: at, text: entryLines(pad) });
    } else {
      throw new Error('custom_providers: in config.yaml is empty; edit it by hand');
    }
  } else if (list.range && list.value === null) {
    // `custom_providers:` with nothing under it
    previous.hadList = false;
    const at = lineEnd(text, list.range[0]);
    edits.push({ start: at, end: at, text: entryLines('  ') });
  } else {
    throw new Error('custom_providers: in config.yaml is not a block list; edit it by hand');
  }

  return { text: applyEdits(text, edits) + tail, previous };
}

export function revertHermesYaml(input: string, previous: HermesPrevious): string {
  let text = input;
  if (!previous.hadModelBlock) {
    text = text.replace(/^model:\n {2}default: "[^\n]*"\n {2}provider: "wavespeed"\n/m, '');
  } else {
    const doc = parseYaml(text);
    const modelNode = (doc.contents as YNode | null)?.get?.('model', true) as YNode | undefined;
    const edits: TextEdit[] = [];
    for (const [key, raw] of [['default', previous.defaultRaw], ['provider', previous.providerRaw]] as const) {
      const v = modelNode?.get?.(key, true) as YNode | undefined;
      if (!v?.range) continue;
      if (raw !== undefined) {
        edits.push({ start: v.range[0], end: v.range[1], text: raw });
      } else {
        const pair = modelNode!.items!.find((p: any) => p.key?.value === key);
        const ks = pair.key.range[0] as number;
        edits.push({ start: lineStart(text, ks), end: lineEnd(text, v.range[1]), text: '' });
      }
    }
    text = applyEdits(text, edits);
  }

  const doc = parseYaml(text);
  const list = (doc.contents as YNode | null)?.get?.('custom_providers', true) as YNode | undefined;
  if (list?.items) {
    const mine = list.items.find((it: any) => it?.get?.('name') === 'wavespeed');
    if (mine?.range) {
      const { dash } = dashPad(text, mine.range[0]);
      const start = lineStart(text, dash);
      const end = contentLineEnd(text, mine.range[1]);
      text = text.slice(0, start) + (previous.entryRaw ?? '') + text.slice(end);
    }
    if (!previous.hadList) {
      const again = parseYaml(text);
      const l2 = (again.contents as YNode | null)?.get?.('custom_providers', true) as YNode | undefined;
      if (l2?.items?.length === 0 || (l2 && l2.items === undefined)) {
        text = text.replace(/^custom_providers:[ \t]*\n?/m, '');
      }
    }
  }
  return text;
}

// ---------- Codex (TOML, edited as text so the user's comments survive) ----------

const TOP_OPEN = '# >>> wavespeed (managed by `wavespeed setup`) >>>';
const TOP_CLOSE = '# <<< wavespeed <<<';
const TAIL_OPEN = '# >>> wavespeed provider >>>';
const TAIL_CLOSE = '# <<< wavespeed provider <<<';
const DISABLED = '# [wavespeed-setup disabled] ';

function stripBlock(text: string, open: string, close: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (line.trim() === open) { skipping = true; continue; }
    if (skipping) { if (line.trim() === close) skipping = false; continue; }
    out.push(line);
  }
  return out.join('\n');
}

export function revertCodexToml(text: string): string {
  let t = stripBlock(text, TOP_OPEN, TOP_CLOSE);
  t = stripBlock(t, TAIL_OPEN, TAIL_CLOSE);
  t = t.split('\n').map((l) => (l.startsWith(DISABLED) ? l.slice(DISABLED.length) : l)).join('\n');
  t = t.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '');
  return t === '' ? '' : t + '\n';
}

export function applyCodexToml(text: string, model: string): string {
  const m = validateModel(model);
  const base = revertCodexToml(text);
  if (/^\s*\[model_providers\.wavespeed\]/m.test(base)) {
    throw new Error('config.toml already defines [model_providers.wavespeed] outside wavespeed setup; edit it by hand');
  }
  // Top-level keys live before the first table header; comment out the ones we replace.
  const lines = base.split('\n');
  let inTop = true;
  const edited = lines.map((l) => {
    if (/^\s*\[/.test(l)) inTop = false;
    return inTop && /^\s*(model|model_provider)\s*=/.test(l) ? DISABLED + l : l;
  });
  const top = [TOP_OPEN, `model = ${JSON.stringify(m)}`, 'model_provider = "wavespeed"', TOP_CLOSE, ''];
  const tail = [
    '',
    TAIL_OPEN,
    '[model_providers.wavespeed]',
    'name = "WaveSpeedAI"',
    `base_url = "${LLM_BASE_URL}"`,
    `env_key = "${KEY_ENV}"`,
    'wire_api = "responses"',
    TAIL_CLOSE,
    '',
  ];
  const body = edited.join('\n').replace(/\n+$/, '');
  return [...top, body, ...tail].join('\n').replace(/\n{3,}/g, '\n\n');
}
