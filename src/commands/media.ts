import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'node:path';
import { requireClient } from '../lib/client.js';
import { resolveLocalFiles } from '../lib/local-files.js';
import { fetchModels, fetchPricing, submitPrediction, waitForPrediction } from '../lib/api.js';
import { uploadWithCache } from '../lib/upload-cache.js';
import { downloadOutputs, printOutputs } from '../lib/output.js';
import { emitJson, emitJsonError, isJsonMode, log, setJsonMode } from '../lib/log.js';
import { downloadOptsFromFlag } from '../lib/download-flag.js';
import { IMAGE_MODEL_KEYS, VIDEO_MODEL_KEYS } from '../lib/media-models.js';
import { planImage, planVideo, type MediaPlan, type Prop, type VideoAction } from '../lib/media-plan.js';

// The shortcut verbs: generate / edit / extend. They use the models of the
// WaveSpeed /chat page and, unlike `run`, deliberately adapt the request to the
// chosen model (endpoint, enum snapping, prompt references). Every adaptation
// is printed, and `--estimate` shows the final input without spending anything.
// `wavespeed run <model>` stays the exact, unmodified path.

async function catalogProps(modelId: string): Promise<Record<string, Prop> | null> {
  const { models } = await fetchModels();
  const schema = models.find((m) => m.model_id === modelId)?.api_schema?.api_schemas?.[0]?.request_schema;
  return (schema?.properties as Record<string, Prop> | undefined) ?? null;
}

const collect = (v: string, prev: string[]) => [...prev, v];

function addCommon(cmd: Command, models: string[]): Command {
  return cmd
    .argument('<prompt>', 'What to create or change. Refer to media as "@image 1", "@video 1", "@audio 1".')
    .option('-m, --model <name>', `Model (${models.join(', ')}); default ${models[0]}. Without it another model is used only if the default cannot take the inputs`)
    .option('--estimate', 'Show the endpoint, final input and price, then stop without submitting')
    .option('--download [path]', 'Save outputs locally (optional path template, e.g. "./out/{index}.{ext}")')
    .option('--output-dir <dir>', 'Directory for --download when no path is given')
    .option('--json', 'Emit a single JSON object on stdout (progress goes to stderr)');
}

interface Common { model?: string; estimate?: boolean; download?: string | boolean; outputDir?: string; json?: boolean }

async function execute(prompt: string, opts: Common, build: (args: Record<string, unknown>) => Promise<MediaPlan>, media: Record<string, unknown>, rest: Record<string, unknown>): Promise<void> {
  setJsonMode(!!opts.json);
  const fail = (message: string): never => {
    if (isJsonMode()) emitJsonError(message);
    else console.error(chalk.red('Error: ') + message);
    process.exit(1);
  };
  const client = requireClient();

  let plan: MediaPlan;
  let uploaded = 0;
  try {
    const spinner = !isJsonMode() ? ora({ color: 'magenta' }) : null;
    const resolved = await resolveLocalFiles(media, {
      allFields: true,
      upload: async (file) => (await uploadWithCache(file, (f) => client.upload(f))).url,
      onUpload: (file, i, total) => spinner?.start(total > 1 ? `Uploading ${path.basename(file)} (${i + 1}/${total})…` : `Uploading ${path.basename(file)}…`),
    });
    uploaded = resolved.uploaded;
    if (uploaded > 0) spinner?.succeed(`Uploaded ${uploaded} file${uploaded === 1 ? '' : 's'}.`);
    plan = await build({ ...rest, ...resolved.input, prompt, model: opts.model });
  } catch (err: any) {
    return fail(err.message ?? String(err));
  }

  let estimate: unknown = null;
  let estimateError: string | undefined;
  try {
    estimate = await fetchPricing(plan.modelId, plan.input);
  } catch (err: any) {
    estimateError = err?.message ?? String(err);
  }

  log('');
  log(chalk.bold('▶ ') + chalk.cyan(plan.modelId) + chalk.gray(`  (${plan.label}, ${plan.mode})`));
  for (const n of plan.notes) log(chalk.yellow('  · ') + n);
  const price = (estimate as { discounted_price?: number; price?: number } | null);
  const cost = price?.discounted_price ?? price?.price;
  if (cost !== undefined) log(chalk.gray('  estimate: ') + chalk.white(`$${cost}`));

  if (opts.estimate) {
    if (isJsonMode()) emitJson({ estimate_only: true, model: plan.modelId, label: plan.label, mode: plan.mode, input: plan.input, notes: plan.notes, estimate, ...(estimateError ? { estimate_error: estimateError } : {}) });
    else log(chalk.gray('  input: ') + JSON.stringify(plan.input));
    return;
  }

  const startedAt = Date.now();
  const spinner = ora({ text: 'Submitting…', color: 'magenta' });
  if (!isJsonMode()) spinner.start();
  let id: string | undefined;
  try {
    const submitted = await submitPrediction(plan.modelId, plan.input);
    id = submitted.id;
    if (!id) throw new Error(`No prediction ID in response: ${JSON.stringify(submitted)}`);
    if (!isJsonMode()) {
      spinner.stopAndPersist({ symbol: chalk.gray('·'), text: chalk.gray('prediction: ') + chalk.white(id) });
      spinner.start('Generating…');
    }
    const onInt = () => {
      process.stderr.write('\n' + chalk.yellow('Interrupted — the task keeps running on the server.') + '\n' + chalk.gray('  resume:  ') + chalk.cyan(`wavespeed show ${id}`) + '\n');
      process.exit(130);
    };
    process.on('SIGINT', onInt);
    const iv = setInterval(() => { spinner.text = `Generating… ${Math.floor((Date.now() - startedAt) / 1000)}s`; }, 200);
    let result;
    try {
      result = submitted.status === 'completed' ? (submitted as any) : await waitForPrediction(id, { intervalMs: 1000 });
    } finally {
      clearInterval(iv);
      process.removeListener('SIGINT', onInt);
    }
    spinner.succeed(`Done in ${Math.floor((Date.now() - startedAt) / 1000)}s.`);

    const urls = ((result.outputs ?? []) as unknown[]).filter((u): u is string => typeof u === 'string');
    let saved: string[] = [];
    const dl = downloadOptsFromFlag(opts.download, { model: plan.modelId, prompt, outputDir: opts.outputDir });
    if (urls.length > 0 && dl) saved = await downloadOutputs(urls, dl);
    if (isJsonMode()) {
      emitJson({ id, model: plan.modelId, label: plan.label, mode: plan.mode, prompt, outputs: urls, saved, notes: plan.notes, estimate, elapsed_ms: Date.now() - startedAt, raw: result });
      return;
    }
    if (urls.length === 0) log(chalk.yellow('No output URLs in response.'));
    else printOutputs(saved, urls);
  } catch (err: any) {
    const message = err.message ?? String(err);
    spinner.fail(message);
    if (id && !isJsonMode()) log(chalk.gray('  query: ') + chalk.cyan(`wavespeed show ${id}`));
    if (isJsonMode()) emitJsonError(message, id ? { prediction_id: id, query_command: `wavespeed show ${id}` } : {});
    process.exit(1);
  }
}

export function registerMedia(program: Command): void {
  const generate = program.command('generate').description('Create an image or video with the /chat models (picks the endpoint from your inputs)');
  const edit = program.command('edit').description('Edit existing images or a video with the /chat models');
  const extend = program.command('extend').description('Continue an existing video');

  addCommon(generate.command('image'), IMAGE_MODEL_KEYS)
    .description('Create an image; with --image, use the pictures as subject/product/face/style')
    .option('--image <ref...>', 'Reference image URL or @path (repeatable)', collect, [])
    .option('--aspect-ratio <r>', 'e.g. 1:1, 16:9, 9:16 (snapped to what the model supports)')
    .option('--resolution <r>', '1k, 2k or 4k')
    .action((prompt, o) => execute(prompt, o, (a) => planImage(a as any, catalogProps), { reference_images: o.image }, { aspect_ratio: o.aspectRatio, resolution: o.resolution }));

  addCommon(edit.command('image'), IMAGE_MODEL_KEYS)
    .description('Change existing images: edits, restyles, backgrounds, combining several')
    .requiredOption('--image <ref...>', 'Image URL or @path to edit (repeatable)', collect, [])
    .option('--aspect-ratio <r>', 'e.g. 1:1, 16:9, 9:16')
    .option('--resolution <r>', '1k, 2k or 4k')
    .action((prompt, o) => execute(prompt, o, (a) => planImage(a as any, catalogProps), { images: o.image }, { aspect_ratio: o.aspectRatio, resolution: o.resolution }));

  const videoOpts = (c: Command) =>
    c
      .option('--duration <s>', 'Seconds', (v) => parseInt(v, 10))
      .option('--resolution <r>', '480p, 540p, 720p, 768p or 1080p (MiniMax H3 maps 720p to 768p)')
      .option('--aspect-ratio <r>', '16:9, 9:16, 1:1, 4:3, 3:4, 21:9');
  const videoRest = (o: any) => ({ duration: o.duration, resolution: o.resolution, aspect_ratio: o.aspectRatio });

  videoOpts(addCommon(generate.command('video'), VIDEO_MODEL_KEYS))
    .description('Create a video; text, image or reference mode is picked from the inputs')
    .option('--first-frame <ref>', 'Image to start from (URL or @path)')
    .option('--last-frame <ref>', 'Image to end on (needs --first-frame)')
    .option('--ref-image <ref...>', 'Reference image (repeatable)', collect, [])
    .option('--ref-video <ref...>', 'Reference video (repeatable)', collect, [])
    .option('--ref-audio <ref...>', 'Reference audio (repeatable)', collect, [])
    .action((prompt, o) =>
      execute(prompt, o, (a) => planVideo(a as any, 'generate' as VideoAction, catalogProps),
        { first_frame: o.firstFrame, last_frame: o.lastFrame, reference_images: o.refImage, reference_videos: o.refVideo, reference_audios: o.refAudio }, videoRest(o)));

  videoOpts(addCommon(edit.command('video'), VIDEO_MODEL_KEYS))
    .description('Edit a video; name it and any references in the prompt ("replace the cat in @video 1 with @image 1")')
    .requiredOption('--video <ref>', 'Video to edit (URL or @path)')
    .option('--ref-image <ref...>', 'Reference image (repeatable)', collect, [])
    .option('--ref-audio <ref...>', 'Reference audio (repeatable)', collect, [])
    .action((prompt, o) =>
      execute(prompt, o, (a) => planVideo(a as any, 'edit', catalogProps),
        { video: o.video, reference_images: o.refImage, reference_audios: o.refAudio }, videoRest(o)));

  videoOpts(addCommon(extend.command('video'), VIDEO_MODEL_KEYS))
    .description('Continue a video from where it ends')
    .requiredOption('--video <ref>', 'Video to extend (URL or @path)')
    .option('--last-frame <ref>', 'Image to end on')
    .option('--ref-image <ref...>', 'Reference image (repeatable)', collect, [])
    .option('--ref-audio <ref...>', 'Reference audio (repeatable)', collect, [])
    .action((prompt, o) =>
      execute(prompt, o, (a) => planVideo(a as any, 'extend', catalogProps),
        { video: o.video, last_frame: o.lastFrame, reference_images: o.refImage, reference_audios: o.refAudio }, videoRest(o)));
}
