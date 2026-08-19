import { Command } from 'commander';
import chalk from 'chalk';
import { loadAliases, loadProjectConfig, PROJECT_FILE, userConfig } from '../lib/config.js';

export function registerAliases(program: Command): void {
  program
    .command('aliases')
    .description('List model aliases defined in wavespeed.json + user config')
    .option('--json', 'Emit the alias map as JSON')
    .action((opts: { json?: boolean }) => {
      const aliases = loadAliases();
      const project = loadProjectConfig();
      const userMap = (userConfig.get('aliases') as Record<string, unknown> | undefined) ?? {};
      const projectMap = project?.aliases ?? {};

      if (opts.json) {
        process.stdout.write(JSON.stringify(aliases, null, 2) + '\n');
        return;
      }

      const names = Object.keys(aliases);
      if (names.length === 0) {
        console.log();
        console.log(chalk.gray('No aliases defined yet.'));
        console.log();
        console.log(chalk.bold('Add one to ' + chalk.cyan(PROJECT_FILE) + ':'));
        console.log(
          chalk.gray(
            JSON.stringify(
              {
                aliases: {
                  hero: {
                    model: 'bytedance/seedream-v5.0-pro',
                    input: { aspect_ratio: '16:9', resolution: '2k' },
                  },
                },
              },
              null,
              2,
            ),
          ),
        );
        console.log();
        return;
      }

      console.log();
      console.log(chalk.bold(`${names.length} alias${names.length === 1 ? '' : 'es'}`));
      console.log();

      const width = Math.max(...names.map((n) => n.length));
      for (const name of names) {
        const a = aliases[name];
        const origin =
          name in projectMap ? chalk.gray('  · project') : name in userMap ? chalk.gray('  · user') : '';
        console.log('  ' + chalk.cyan(name.padEnd(width)) + '  ' + chalk.white(a.model) + origin);
        if (a.description) console.log('  ' + ' '.repeat(width) + '  ' + chalk.gray(a.description));
        if (a.input && Object.keys(a.input).length > 0) {
          console.log('  ' + ' '.repeat(width) + '  ' + chalk.gray(JSON.stringify(a.input)));
        }
      }

      console.log();
      console.log(chalk.gray('Use: ') + chalk.cyan('wavespeed run <alias> -p "…"'));
      console.log(chalk.gray('Inspect: ') + chalk.cyan('wavespeed run <alias> -h'));
      console.log();
    });
}
