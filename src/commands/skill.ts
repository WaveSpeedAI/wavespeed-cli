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

export function writeSkill(cwd: string = process.cwd()): string {
  const dest = path.join(cwd, '.claude', 'skills', 'wavespeed', 'SKILL.md');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(skillSourcePath(), dest);
  return dest;
}

export function registerSkill(program: Command): void {
  const skill = program
    .command('skill')
    .description('Install a Wavespeed skill for Claude Code, Cursor, Codex, and other coding agents');

  skill
    .command('install', { isDefault: true })
    .description('Drop a SKILL.md into .claude/skills/wavespeed/ so Claude Code, Cursor, and Codex know how to call the CLI')
    .option('--print', 'Print the skill body to stdout instead of writing a file')
    .action((opts: { print?: boolean }) => {
      if (opts.print) {
        process.stdout.write(fs.readFileSync(skillSourcePath(), 'utf8'));
        return;
      }
      const dest = writeSkill();
      console.log();
      console.log(chalk.green('Installed skill: ') + chalk.cyan(path.relative(process.cwd(), dest)));
      console.log();
      console.log(chalk.bold('You\'re set.'));
      console.log(chalk.gray('  Claude Code, Cursor, and other agents auto-discover .claude/skills/*.'));
      console.log(chalk.gray('  Agents will call the CLI directly — no MCP server, no extra config.'));
      console.log();
      console.log(chalk.gray('  Quick check: ask the agent to run ') + chalk.cyan('wavespeed models') + chalk.gray('.'));
      console.log();
    });
}
