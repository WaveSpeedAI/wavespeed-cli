#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { printBanner } from './lib/banner.js';
import { registerAuth } from './commands/auth.js';
import { registerRun } from './commands/run.js';
import { registerUpload } from './commands/upload.js';
import { registerDownload } from './commands/download.js';
import { registerModels } from './commands/models.js';
import { registerSchema } from './commands/schema.js';
import { registerAliases } from './commands/aliases.js';
import { registerInit } from './commands/init.js';
import { registerSkill } from './commands/skill.js';
import { registerBalance } from './commands/balance.js';
import { registerPrice } from './commands/price.js';
import { registerTopUp } from './commands/topup.js';
import { registerHistory } from './commands/history.js';
import { registerShow } from './commands/show.js';
import { registerDelete } from './commands/delete.js';
import { registerOpen } from './commands/open.js';
import { detectRunHelp, printDynamicRunHelp } from './lib/dynamic-help.js';

// Read version from package.json at runtime so a bump in package.json is
// reflected automatically (no second place to keep in sync).
const VERSION: string = (() => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/cli.js → ../package.json (one level up because files: ["dist", ...])
  const pkgPath = path.resolve(here, '..', 'package.json');
  return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version as string;
})();

const program = new Command();
program
  .name('wavespeed')
  .description('WaveSpeed CLI — one command to run any WaveSpeed AI model from your terminal.')
  .version(VERSION, '-v, --version', 'Print the CLI version')
  .addHelpText(
    'beforeAll',
    chalk.hex('#7c5cff').bold('\n  wavespeed  ') + chalk.gray(`v${VERSION}  ·  every WaveSpeed model  ·  open source\n`),
  )
  .addHelpText(
    'after',
    `
${chalk.bold('Quick start:')}
  ${chalk.cyan('$ wavespeed login')}
  ${chalk.cyan('$ wavespeed models                                                # browse the catalog')}
  ${chalk.cyan('$ wavespeed run wavespeed-ai/z-image/turbo -h                    # see the model\'s flags')}
  ${chalk.cyan('$ wavespeed run wavespeed-ai/z-image/turbo -p "a cyberpunk skyline"   # ~5s')}
  ${chalk.cyan('$ wavespeed run bytedance/seedance-2.0/text-to-video -p "drone shot over snowy peaks"')}

${chalk.bold('Use from any coding agent (Claude Code, Cursor, Codex):')}
  ${chalk.cyan('$ wavespeed skill install')}   ${chalk.gray('# drops a SKILL.md so the agent knows how to call wavespeed')}
  ${chalk.gray('# agents just shell out: `wavespeed run <id> --json` — no MCP setup.')}

${chalk.gray('Docs:')} ${chalk.cyan('https://wavespeed.ai/docs')}    ${chalk.gray('Models:')} ${chalk.cyan('https://wavespeed.ai/models')}
`,
  );

registerAuth(program);
registerRun(program);
registerUpload(program);
registerDownload(program);
registerModels(program);
registerSchema(program);
registerAliases(program);
registerBalance(program);
registerPrice(program);
registerTopUp(program);
registerHistory(program);
registerShow(program);
registerDelete(program);
registerOpen(program);
registerInit(program);
registerSkill(program);

program
  .command('hello', { hidden: true })
  .description('Print the WaveSpeed banner')
  .action(() => printBanner());

// Show banner + help when run with no args
if (process.argv.length <= 2) {
  printBanner();
  program.outputHelp();
  process.exit(0);
}

async function main(): Promise<void> {
  // Intercept `wavespeed run <model> --help` so we can introspect the model's
  // schema and print model-specific flags instead of Commander's static help.
  const dynamicModel = detectRunHelp(process.argv);
  if (dynamicModel) {
    await printDynamicRunHelp(dynamicModel);
    // If schema lookup failed, fall through to Commander's static help.
  }
  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(chalk.red('Error: ') + (err.message ?? String(err)));
  process.exit(1);
});
