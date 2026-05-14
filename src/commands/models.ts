import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { fetchModels, LiveModel } from '../lib/api.js';

function priceLabel(p?: number): string {
  if (p === undefined) return '';
  if (p === 0) return chalk.green(' free ');
  return chalk.gray(`$${p.toFixed(p < 0.1 ? 3 : 2)}`);
}

function filterModels(
  models: LiveModel[],
  query: string | undefined,
  type: string | undefined,
): LiveModel[] {
  const q = query?.toLowerCase().trim();
  return models.filter((m) => {
    if (type && m.type !== type) return false;
    if (!q) return true;
    return (
      m.model_id.toLowerCase().includes(q) ||
      (m.name?.toLowerCase().includes(q) ?? false) ||
      (m.description?.toLowerCase().includes(q) ?? false)
    );
  });
}

function shortDescription(m: LiveModel, max = 100): string {
  if (!m.description) return '';
  const single = m.description.replace(/\s+/g, ' ').trim();
  return single.length > max ? single.slice(0, max - 1) + '…' : single;
}

export function registerModels(program: Command): void {
  program
    .command('models')
    .description('Browse every Wavespeed model live from api.wavespeed.ai (cached for 1h)')
    .argument('[query]', 'Search query (matches id, name, description)')
    .option('-t, --type <name>', 'Filter by type (text-to-image, image-to-video, …)')
    .option('-c, --category <name>', 'Alias for --type')
    .option('--popular', 'Show only the top-sorted models (sort_order <= 10000)')
    .option('--refresh', 'Force a live fetch and refresh the cache')
    .option('--no-cache', 'Skip the cache for this call (do not read or write)')
    .option('--json', 'Emit the raw model list as JSON')
    .action(
      async (
        query: string | undefined,
        opts: {
          type?: string;
          category?: string;
          popular?: boolean;
          refresh?: boolean;
          cache: boolean;
          json?: boolean;
        },
      ) => {
        const type = opts.type ?? opts.category;

        const spinner = !opts.json
          ? ora('Fetching models from api.wavespeed.ai…').start()
          : null;
        let payload: { models: LiveModel[]; source: 'cache' | 'live' };
        try {
          payload = await fetchModels({ refresh: opts.refresh, noCache: !opts.cache });
        } catch (err: any) {
          spinner?.fail(err.message ?? String(err));
          if (opts.json) {
            process.stdout.write(JSON.stringify({ error: err.message ?? String(err) }, null, 2) + '\n');
          }
          process.exit(1);
        }
        spinner?.stop();

        let results = filterModels(payload.models, query, type);
        if (opts.popular) {
          results = results
            .filter((m) => (m.sort_order ?? 99999) <= 10000)
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
        } else {
          results.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
        }

        if (opts.json) {
          process.stdout.write(JSON.stringify(results, null, 2) + '\n');
          return;
        }

        const total = payload.models.length;
        const shown = results.length;
        console.log();
        console.log(
          chalk.bold(`${shown.toLocaleString()} model${shown === 1 ? '' : 's'}`) +
            chalk.gray(` of ${total.toLocaleString()} live on Wavespeed`) +
            chalk.gray(payload.source === 'cache' ? '  ·  cached' : '  ·  fresh'),
        );
        console.log();

        const byType = new Map<string, LiveModel[]>();
        for (const m of results) {
          const t = m.type || 'other';
          if (!byType.has(t)) byType.set(t, []);
          byType.get(t)!.push(m);
        }

        for (const [t, models] of byType) {
          console.log(chalk.hex('#7c5cff').bold(t) + chalk.gray(`  ${models.length}`));
          for (const m of models) {
            const id = chalk.cyan(m.model_id.padEnd(52));
            const price = priceLabel(m.base_price);
            console.log(`  ${id} ${price}`);
            const d = shortDescription(m);
            if (d) console.log(`    ${chalk.gray(d)}`);
          }
          console.log();
        }

        console.log(
          chalk.gray('Run any model with: ') +
            chalk.cyan('wavespeed run <id> --input prompt="…"'),
        );
        console.log(chalk.gray('Refresh the cache:  ') + chalk.cyan('wavespeed models --refresh'));
        console.log();
      },
    );
}
