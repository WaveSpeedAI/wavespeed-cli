import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import { input, confirm } from '@inquirer/prompts';
import { PROJECT_FILE, ProjectConfig } from '../lib/config.js';

const STARTER_MODEL = 'bytedance/seedream-v5.0-pro';

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Create a wavespeed.json with a defaultModel + alias stubs in this directory')
    .option('-y, --yes', 'Skip prompts, write sensible defaults')
    .option('-f, --force', 'Overwrite an existing wavespeed.json')
    .action(async (opts: { yes?: boolean; force?: boolean }) => {
      const target = path.resolve(PROJECT_FILE);
      if (fs.existsSync(target) && !opts.force) {
        console.log(chalk.yellow(`${PROJECT_FILE} already exists.`) + chalk.gray('  Pass --force to overwrite.'));
        process.exit(1);
      }

      let project: ProjectConfig;
      if (opts.yes) {
        project = {
          $schema: 'https://wavespeed.ai/schema/cli.json',
          defaultModel: STARTER_MODEL,
          outputDir: 'wavespeed-output',
          aliases: {},
        };
      } else {
        console.log();
        console.log(chalk.bold('Project config'));
        console.log(
          chalk.gray('Sets the per-project defaults the team can share via git. You can edit wavespeed.json anytime.'),
        );
        console.log();

        const defaultModel = await input({
          message: 'Default model (browse with `wavespeed models`):',
          default: STARTER_MODEL,
        });
        const outputDir = await input({ message: 'Output directory (for --download):', default: 'wavespeed-output' });

        project = {
          $schema: 'https://wavespeed.ai/schema/cli.json',
          defaultModel,
          outputDir,
          aliases: {},
        };
      }

      fs.writeFileSync(target, JSON.stringify(project, null, 2) + '\n');
      console.log();
      console.log(chalk.green('Wrote ') + chalk.cyan(PROJECT_FILE));
      console.log();
      console.log(chalk.gray('Now try:'));
      console.log('  ' + chalk.cyan('wavespeed run -p "a serene mountain lake at sunrise"'));
      console.log(chalk.gray('Add aliases by editing wavespeed.json — see ') + chalk.cyan('wavespeed aliases'));
      console.log();

      if (!opts.yes) {
        const tellAgent = await confirm({
          message: 'Add a Claude/Cursor skill so agents can call Wavespeed too?',
          default: true,
        });
        if (tellAgent) {
          await import('./skill.js').then(({ writeSkill }) => writeSkill(process.cwd()));
        }
      }
    });
}
