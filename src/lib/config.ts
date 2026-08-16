import Conf from 'conf';
import path from 'node:path';
import fs from 'node:fs';

export interface ModelAlias {
  model: string;
  input?: Record<string, unknown>;
  description?: string;
}

export interface UserConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  outputDir?: string;
  aliases?: Record<string, ModelAlias>;
}

export const DEFAULTS = {
  baseUrl: 'https://api.wavespeed.ai',
  outputDir: 'wavespeed-output',
};

export const userConfig = new Conf<UserConfig>({
  projectName: 'wavespeed',
  defaults: {},
  // The config file holds the API key in cleartext; owner-only, not the
  // default 0664 that leaves it group-readable.
  configFileMode: 0o600,
});

// conf only applies configFileMode on write. Tighten a config that an older
// CLI version already left group-readable.
try {
  if (fs.existsSync(userConfig.path)) fs.chmodSync(userConfig.path, 0o600);
} catch {
  /* best effort */
}

export interface ProjectConfig {
  $schema?: string;
  defaultModel?: string;
  outputDir?: string;
  aliases?: Record<string, ModelAlias>;
}

export const PROJECT_FILE = 'wavespeed.json';

export function loadProjectConfig(cwd: string = process.cwd()): ProjectConfig | null {
  let dir = cwd;
  while (true) {
    const candidate = path.join(dir, PROJECT_FILE);
    if (fs.existsSync(candidate)) {
      try {
        return JSON.parse(fs.readFileSync(candidate, 'utf8'));
      } catch {
        return null;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function getApiKey(): string | undefined {
  return process.env.WAVESPEED_API_KEY || userConfig.get('apiKey');
}

export function getBaseUrl(): string {
  // Env first, matching how the key resolves: CI pointing one command at the
  // test environment must not require editing the user-level config.
  return process.env.WAVESPEED_BASE_URL || userConfig.get('baseUrl') || DEFAULTS.baseUrl;
}

export function resolveOutputDir(): string {
  const project = loadProjectConfig();
  return project?.outputDir || userConfig.get('outputDir') || DEFAULTS.outputDir;
}

export function resolveDefaultModel(): string | undefined {
  const project = loadProjectConfig();
  return project?.defaultModel || userConfig.get('defaultModel');
}

/**
 * All defined aliases, project taking precedence over user-level.
 */
export function loadAliases(): Record<string, ModelAlias> {
  const userAliases = (userConfig.get('aliases') as Record<string, ModelAlias> | undefined) ?? {};
  const projectAliases = loadProjectConfig()?.aliases ?? {};
  return { ...userAliases, ...projectAliases };
}

export function findAlias(name: string): ModelAlias | undefined {
  return loadAliases()[name];
}

/**
 * Resolve a positional that may be a model_id, an alias, or undefined.
 * Returns the underlying model_id and any default input the alias supplied.
 *
 * Rules:
 *  - tokens containing `/` are always treated as model_ids (never alias-resolved)
 *  - otherwise check aliases
 *  - if neither: try defaultModel, which itself may be an alias name
 */
export function resolveModelToken(token: string | undefined): {
  model: string;
  defaultInput?: Record<string, unknown>;
  source: 'positional' | 'alias' | 'default';
  alias?: string;
} | null {
  const tryResolve = (value: string, source: 'positional' | 'alias' | 'default'): ReturnType<typeof resolveModelToken> => {
    if (value.includes('/')) return { model: value, source };
    const alias = findAlias(value);
    if (alias) return { model: alias.model, defaultInput: alias.input, source: 'alias', alias: value };
    return null;
  };

  if (token) {
    const direct = tryResolve(token, 'positional');
    if (direct) return direct;
    // Unknown bare name — not a model_id, not an alias. Surface this to the caller
    // so it can show a helpful error instead of silently picking the default.
    return null;
  }

  const def = resolveDefaultModel();
  if (!def) return null;
  return tryResolve(def, 'default');
}

