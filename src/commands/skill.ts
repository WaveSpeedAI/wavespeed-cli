import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function skillSourcePath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/commands/skill.js -> ../../skills/SKILL.md
  return path.resolve(here, '..', '..', 'skills', 'SKILL.md');
}

// Two discovery roots cover every agent we target: Claude Code, Cursor and
// OpenCode read `.claude/skills/`; Codex, Kimi Code and the wider agents.md
// ecosystem read `.agents/skills/`. Writing both keeps a single install
// command working everywhere.
export const SKILL_ROOTS = ['.claude', '.agents'] as const;

export function writeSkills(cwd: string = process.cwd()): string[] {
  return SKILL_ROOTS.map((root) => {
    const dest = path.join(cwd, root, 'skills', 'wavespeed', 'SKILL.md');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(skillSourcePath(), dest);
    return dest;
  });
}

/** @deprecated use writeSkills — kept for callers that expect the Claude path. */
export function writeSkill(cwd: string = process.cwd()): string {
  return writeSkills(cwd)[0];
}

export function registerSkill(program: Command): void {
  const skill = program
    .command('skill')
    .description('Install a Wavespeed skill for Claude Code, Cursor, Codex, and other coding agents');

  skill
    .command('install', { isDefault: true })
    .description('Drop a SKILL.md into .claude/skills/ and .agents/skills/ so Claude Code, Cursor, Codex, Kimi Code and other agents know how to call the CLI')
    .option('--print', 'Print the skill body to stdout instead of writing a file')
    .action((opts: { print?: boolean }) => {
      if (opts.print) {
        process.stdout.write(fs.readFileSync(skillSourcePath(), 'utf8'));
        return;
      }
      const dests = writeSkills();
      console.log();
      for (const dest of dests) {
        console.log(chalk.green('Installed skill: ') + chalk.cyan(path.relative(process.cwd(), dest)));
      }
      console.log();
      console.log(chalk.bold('You\'re set.'));
      console.log(chalk.gray('  Claude Code, Cursor and OpenCode read .claude/skills/*; Codex, Kimi Code and other agents read .agents/skills/*.'));
      console.log(chalk.gray('  Agents will call the CLI directly — no MCP server, no extra config.'));
      console.log();
      console.log(chalk.gray('  Quick check: ask the agent to run ') + chalk.cyan('wavespeed models') + chalk.gray('.'));
      console.log();
    });
}
