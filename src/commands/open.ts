import { Command } from 'commander';
import chalk from 'chalk';
import open from 'open';
import { LINKS } from '../lib/links.js';

export function registerOpen(program: Command): void {
  program
    .command('open')
    .description('Open a Wavespeed page in your browser (dashboard, models, history, top-up, …)')
    .argument(
      '[target]',
      `Target to open: ${Object.keys(LINKS).join(', ')}. Omit to list them.`,
    )
    .option('--print', 'Print the URL, do not open the browser')
    .option('--json', 'Emit the link map as JSON (only when no target is given)')
    .action(async (target: string | undefined, opts: { print?: boolean; json?: boolean }) => {
      if (!target) {
        if (opts.json) {
          process.stdout.write(JSON.stringify(LINKS, null, 2) + '\n');
          return;
        }
        console.log();
        console.log(chalk.bold('Useful Wavespeed pages'));
        console.log();
        const width = Math.max(...Object.keys(LINKS).map((k) => k.length));
        for (const [name, link] of Object.entries(LINKS)) {
          console.log('  ' + chalk.cyan(name.padEnd(width)) + '  ' + chalk.white(link.url));
          console.log('  ' + ' '.repeat(width) + '  ' + chalk.gray(link.desc));
        }
        console.log();
        console.log(chalk.gray('Use: ') + chalk.cyan('wavespeed open <target>'));
        console.log();
        return;
      }

      const link = LINKS[target];
      if (!link) {
        const msg = `Unknown target "${target}". Available: ${Object.keys(LINKS).join(', ')}.`;
        console.error(chalk.red('Error: ') + msg);
        process.exit(1);
      }

      if (opts.print) {
        process.stdout.write(link.url + '\n');
        return;
      }

      console.log(chalk.gray('Opening ') + chalk.cyan(link.url));
      try {
        await open(link.url);
      } catch {
        /* Browser launch failed — URL was printed above */
      }
    });
}
