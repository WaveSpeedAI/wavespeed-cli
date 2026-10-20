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

// ---------- JSON agents (Claude Code, OpenCode) ----------

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
