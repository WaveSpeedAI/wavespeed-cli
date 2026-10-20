import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { confirm } from '@inquirer/prompts';
import JSON5 from 'json5';
import { getApiKey, userConfig } from '../lib/config.js';
import { clientAttributionHeaders } from '../lib/client-headers.js';
import { emitJson, emitJsonError, info, setJsonMode } from '../lib/log.js';
import {
  DEFAULT_MODEL, KEY_ENV, LLM_BASE_URL, HermesPrevious, JsonPrevious,
  applyCodexToml, applyHermesYaml, applyJson, applyYamlScalars, claudeEdits, miniAgentValues, openclawEdits, opencodeEdits, qwenEdits,
  revertCodexToml, revertHermesYaml, revertJson, revertYamlScalars, validateModel,
} from '../lib/setup-agents.js';

type AgentId = 'claude' | 'codex' | 'opencode' | 'openclaw' | 'hermes' | 'cline' | 'qwen' | 'miniagent';

interface Agent {
  id: AgentId;
  name: string;
  file: string;
  command: string;
  /** json/json5: merged key by key; toml/yaml: edited as text; cline: delegated to `cline auth`. */
  kind: 'json' | 'json5' | 'toml' | 'yaml' | 'yamlscalars' | 'cline';
  /** The key ends up inside the config file (otherwise it is read from $WAVESPEED_API_KEY). */
  keyInFile: boolean;
}

const home = os.homedir();
const AGENTS: Agent[] = [
  { id: 'claude', name: 'Claude Code', file: path.join(home, '.claude', 'settings.json'), command: 'claude', kind: 'json', keyInFile: true },
  { id: 'codex', name: 'Codex', file: path.join(home, '.codex', 'config.toml'), command: 'codex', kind: 'toml', keyInFile: false },
  { id: 'opencode', name: 'OpenCode', file: path.join(home, '.config', 'opencode', 'opencode.json'), command: 'opencode', kind: 'json', keyInFile: false },
  { id: 'openclaw', name: 'OpenClaw', file: path.join(home, '.openclaw', 'openclaw.json'), command: 'openclaw', kind: 'json5', keyInFile: false },
  { id: 'hermes', name: 'Hermes', file: path.join(home, '.hermes', 'config.yaml'), command: 'hermes', kind: 'yaml', keyInFile: false },
  { id: 'qwen', name: 'Qwen Code', file: path.join(home, '.qwen', 'settings.json'), command: 'qwen', kind: 'json', keyInFile: false },
  { id: 'miniagent', name: 'Mini-Agent', file: path.join(home, '.mini-agent', 'config', 'config.yaml'), command: 'mini-agent', kind: 'yamlscalars', keyInFile: true },
  // Cline's CLI keeps provider settings (including the key) in this file; we write it only through `cline auth`.
  { id: 'cline', name: 'Cline', file: path.join(home, '.cline', 'data', 'settings', 'providers.json'), command: 'cline', kind: 'cline', keyInFile: true },
];

const shown = (p: string) => p.replace(home, '~');

function onPath(cmd: string): boolean {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  return (process.env.PATH ?? '').split(path.delimiter).some((d) => d && exts.some((e) => fs.existsSync(path.join(d, cmd + e))));
}

/** One streamed request to the same endpoint family the agents use; proves key, model and streaming work. */
export async function selfCheck(apiKey: string, model: string): Promise<{ ok: boolean; detail: string }> {
  const base = process.env.WAVESPEED_LLM_BASE_URL || LLM_BASE_URL;
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}`, ...clientAttributionHeaders() },
      // Reasoning models spend tokens thinking first; leave room for a visible reply.
      body: JSON.stringify({ model, stream: true, max_tokens: 256, messages: [{ role: 'user', content: 'Reply with the single word READY.' }] }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const text = await res.text();
    const chunks = text.split('\n').filter((l) => l.startsWith('data: ') && !l.includes('[DONE]'));
    if (chunks.length === 0) return { ok: false, detail: 'stream returned no data' };
    if (chunks.some((l) => l.includes('"error"'))) return { ok: false, detail: 'stream contained an error' };
    return { ok: true, detail: `${chunks.length} stream chunks` };
  } catch (err: any) {
    return { ok: false, detail: err.message ?? String(err) };
  }
}

function readJson(file: string, json5 = false): Record<string, unknown> {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8');
  if (raw.trim() === '') return {};
  try {
    const v = json5 ? JSON5.parse(raw) : JSON.parse(raw);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch {
    /* fall through */
  }
  throw new Error(`${shown(file)} is not plain JSON (comments or trailing commas?). Edit it by hand using the snippet at https://wavespeed.ai/llm/agents`);
}

function writeFile(file: string, content: string, secret: boolean): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bak = `${file}.wavespeed.bak`;
  if (fs.existsSync(file) && !fs.existsSync(bak)) fs.copyFileSync(file, bak);
  fs.writeFileSync(file, content, secret ? { mode: 0o600 } : undefined);
  if (secret) fs.chmodSync(file, 0o600);
}

function envHint(): string {
  return process.platform === 'win32'
    ? `setx ${KEY_ENV} "<your key>"   (then open a new terminal)`
    : `export ${KEY_ENV}="<your key>"   # add to ~/.zshrc or ~/.bashrc`;
}

export function registerSetup(program: Command): void {
  program
    .command('setup [agent]')
    .description('Point a coding agent (claude, codex, opencode, openclaw, hermes, cline, qwen, miniagent) at the WaveSpeed LLM gateway')
    .option('--model <id>', `Model to use (default: ${DEFAULT_MODEL})`)
    .option('--dry-run', 'Show what would change without writing anything')
    .option('--undo', "Restore the agent's config to what it was before setup")
    .option('-y, --yes', 'Do not ask for confirmation')
    .option('--no-check', 'Skip the live request that verifies the setup')
    .option('--json', 'Emit JSON')
    .action(async (agentId: string | undefined, opts: { model?: string; dryRun?: boolean; undo?: boolean; yes?: boolean; check: boolean; json?: boolean }) => {
      setJsonMode(!!opts.json);
      const fail = (message: string): never => {
        if (opts.json) emitJsonError(message);
        else console.error(chalk.red('Error: ') + message);
        process.exit(1);
      };

      if (!agentId) {
        const rows = AGENTS.map((a) => ({ agent: a.id, name: a.name, config: shown(a.file), installed: onPath(a.command) }));
        if (opts.json) return emitJson(rows);
        info(chalk.bold('Agents:'));
        for (const r of rows) info(`  ${chalk.cyan(r.agent.padEnd(9))} ${r.name.padEnd(12)} ${chalk.gray(r.config)}  ${r.installed ? chalk.green('found') : chalk.gray('not on PATH')}`);
        info('\nRun ' + chalk.cyan('wavespeed setup <agent>') + ' (add --dry-run to preview, --undo to revert).');
        return;
      }

      const agent = AGENTS.find((a) => a.id === agentId);
      if (!agent) return fail(`Unknown agent "${agentId}". Choose one of: ${AGENTS.map((a) => a.id).join(', ')}`);

      // ----- undo -----
      if (opts.undo) {
        try {
          const state = userConfig.get('setup')?.[agent.id];
          const forget = () => {
            const rest = { ...(userConfig.get('setup') ?? {}) };
            delete rest[agent.id];
            userConfig.set('setup', rest);
          };
          if (agent.kind === 'toml') {
            if (!fs.existsSync(agent.file)) return fail(`${shown(agent.file)} does not exist; nothing to undo`);
            const before = fs.readFileSync(agent.file, 'utf8');
            const after = revertCodexToml(before);
            if (!opts.dryRun && after !== before) fs.writeFileSync(agent.file, after);
          } else if (!state) {
            return fail(`No recorded ${agent.name} setup to undo`);
          } else if (agent.kind === 'cline') {
            const bak = `${agent.file}.wavespeed.bak`;
            if (!opts.dryRun) {
              if ((state.previous as { existed: boolean }).existed && fs.existsSync(bak)) fs.copyFileSync(bak, agent.file);
              else fs.rmSync(agent.file, { force: true });
              fs.rmSync(bak, { force: true });
              forget();
            }
          } else if (agent.kind === 'yamlscalars') {
            const after = revertYamlScalars(fs.readFileSync(state.file, 'utf8'), state.previous as Record<string, string | null>);
            if (!opts.dryRun) {
              if (after.trim() === '') fs.rmSync(state.file, { force: true }); else fs.writeFileSync(state.file, after);
              forget();
            }
          } else if (agent.kind === 'yaml') {
            const after = revertHermesYaml(fs.readFileSync(state.file, 'utf8'), state.previous as HermesPrevious);
            if (!opts.dryRun) { fs.writeFileSync(state.file, after); forget(); }
          } else {
            const doc = readJson(state.file, agent.kind === 'json5');
            const after = JSON.stringify(revertJson(doc, state.previous as JsonPrevious[]), null, 2) + '\n';
            if (!opts.dryRun) { fs.writeFileSync(state.file, after); forget(); }
          }
        } catch (err: any) {
          return fail(err.message ?? String(err));
        }
        if (opts.json) return emitJson({ agent: agent.id, undone: !opts.dryRun, file: agent.file });
        info(chalk.green(opts.dryRun ? `Would restore ${shown(agent.file)}.` : `Restored ${shown(agent.file)}.`));
        return;
      }

      // ----- apply -----
      const apiKey = getApiKey();
      if (!apiKey) return fail('No API key. Run `wavespeed login` first.');
      let model: string;
      try {
        model = validateModel(opts.model ?? DEFAULT_MODEL);
      } catch (err: any) {
        return fail(err.message);
      }

      let next = '';
      let previous: unknown = [];
      try {
        if (agent.kind === 'toml') {
          next = applyCodexToml(fs.existsSync(agent.file) ? fs.readFileSync(agent.file, 'utf8') : '', model);
        } else if (agent.kind === 'yaml') {
          const r = applyHermesYaml(fs.existsSync(agent.file) ? fs.readFileSync(agent.file, 'utf8') : '', model);
          next = r.text;
          previous = r.previous;
        } else if (agent.kind === 'yamlscalars') {
          const r = applyYamlScalars(fs.existsSync(agent.file) ? fs.readFileSync(agent.file, 'utf8') : '', miniAgentValues(model, apiKey));
          next = r.text;
          previous = r.previous;
        } else if (agent.kind === 'cline') {
          previous = { existed: fs.existsSync(agent.file) };
          if (!onPath('cline')) throw new Error('Cline CLI not found. Install it with `npm i -g cline`. (The VS Code extension has no config file; set it up in its settings UI.)');
        } else {
          const base = readJson(agent.file, agent.kind === 'json5');
          const edits = agent.id === 'claude' ? claudeEdits(model, apiKey) : agent.id === 'openclaw' ? openclawEdits(model, base) : agent.id === 'qwen' ? qwenEdits(model) : opencodeEdits(model);
          const r = applyJson(base, edits);
          previous = r.previous;
          next = JSON.stringify(r.doc, null, 2) + '\n';
        }
      } catch (err: any) {
        return fail(err.message ?? String(err));
      }

      const exists = fs.existsSync(agent.file);
      if (opts.dryRun) {
        if (opts.json) return emitJson({ agent: agent.id, model, file: agent.file, dry_run: true, will_create: !exists });
        info(chalk.bold(`Would ${exists ? 'update' : 'create'} ${shown(agent.file)}`) + chalk.gray(` (model ${model}${agent.keyInFile ? '; your API key would be stored in this file' : ''})`));
        info(chalk.gray('Nothing written.'));
        return;
      }

      if (agent.keyInFile && !opts.yes) {
        if (!process.stdin.isTTY) return fail(`${agent.name} needs your API key stored in ${shown(agent.file)}. Re-run with --yes to allow that.`);
        info(chalk.yellow(`${agent.name} will use WaveSpeed instead of its own login for every session, and your API key will be stored in ${shown(agent.file)}.`));
        info(chalk.gray(`Undo any time with: wavespeed setup ${agent.id} --undo`));
        if (!(await confirm({ message: 'Continue?', default: false }))) return fail('Cancelled; nothing written.');
      }

      if (agent.kind === 'cline') {
        const bak = `${agent.file}.wavespeed.bak`;
        if (fs.existsSync(agent.file) && !fs.existsSync(bak)) fs.copyFileSync(agent.file, bak);
        const r = spawnSync('cline', ['auth', '-p', 'openai-compatible', '-k', apiKey, '-b', LLM_BASE_URL, '-m', model], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', shell: process.platform === 'win32' });
        if (r.status !== 0) return fail(`cline auth failed: ${(r.stderr || r.error?.message || '').trim().slice(0, 300)}`);
      } else {
        const hadComments = agent.kind === 'json5' && exists && /^\s*\/\/|\/\*/m.test(fs.readFileSync(agent.file, 'utf8'));
        writeFile(agent.file, next, agent.keyInFile);
        if (hadComments) info(chalk.yellow(`Comments in ${shown(agent.file)} were not kept; the original is saved as ${shown(agent.file)}.wavespeed.bak`));
      }
      if (agent.kind !== 'toml') userConfig.set('setup', { ...(userConfig.get('setup') ?? {}), [agent.id]: { file: agent.file, previous } });

      const check = opts.check ? await selfCheck(apiKey, model) : null;
      if (opts.json) {
        emitJson({ agent: agent.id, model, file: agent.file, written: true, check: check ? { ok: check.ok, detail: check.detail } : 'skipped', needs_env: agent.keyInFile ? null : KEY_ENV });
        if (check && !check.ok) process.exit(1);
        return;
      }
      info(chalk.green(`Updated ${shown(agent.file)}`) + chalk.gray(` (model ${model})`));
      if (check) info(check.ok ? chalk.green(`Verified: streamed reply from ${model} (${check.detail}).`) : chalk.red(`Check failed: ${check.detail}`));
      if (!agent.keyInFile) {
        info(`\nThe key is read from ${chalk.bold(KEY_ENV)}; set it in the shell that launches ${agent.command}:\n  ${chalk.cyan(envHint())}\n  Keys: https://wavespeed.ai/accesskey`);
      }
      info(`\nStart it with ${chalk.cyan(agent.command)}. Revert with ${chalk.cyan(`wavespeed setup ${agent.id} --undo`)}.`);
      if (check && !check.ok) process.exit(1);
    });
}
