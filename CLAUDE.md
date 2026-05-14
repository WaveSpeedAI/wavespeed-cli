# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run dev -- <subcommand> [args]   # run from source via tsx (no build needed)
npm run build                         # tsc → dist/
npm run lint                          # tsc --noEmit
npm run format                        # prettier on src/**/*.ts
```

No automated test suite. Verification is end-to-end against `api.wavespeed.ai` using a real API key. After changes, exercise the affected command in a scratch directory.

## Architecture

**One generation verb.** `wavespeed run <model_id|alias>` is the only generate command. Everything else is auxiliary (auth, catalog browse, schema, upload/download, project config).

**Two invariants that span multiple files:**

1. **JSON-first stdout protocol** (`src/lib/log.ts`). When `--json` is set, stdout is reserved for the final JSON payload only; progress, spinners, and human text go to stderr. Use `setJsonMode/log/emitJson/emitJsonError` in any new command.

2. **The CLI never mutates user input.** What the user passes is what hits the API. Don't add silent prompt prefixes, palette injections, or style suffixes. Aliases (which are named and explicit) are the only mechanism for bundling extra inputs.

**Live API as catalog source.** `src/lib/api.ts:fetchModels()` calls `GET /api/v3/models` and caches the response to `~/.cache/wavespeed/models.json` (1h TTL, keyed on baseUrl). `models`, `schema`, and dynamic `run -h` all read from this single payload. There is no bundled catalog.

**Dynamic per-model help.** `src/lib/dynamic-help.ts:detectRunHelp()` is called from `src/cli.ts:main()` **before** Commander parses argv. When it matches `wavespeed run <token> -h`, it resolves aliases, fetches the schema, and prints model-specific input help. Falls through to Commander's static help on failure.

**Token resolution** (`src/lib/config.ts:resolveModelToken()`):
- Contains `/` → always a model ID.
- Bare name → looked up in `aliases` (project beats user); unknown bare names return `null` so the caller fails loudly.
- Missing → falls back to `defaultModel` (which itself may be an alias name).

**Input merge order in `run`**: `alias.input` < `--input-file` < `-i k=v` < `-p prompt`. CLI flags always override alias defaults.

**Config locations**:
- `wavespeed.json` (walks up CWD tree) — project: `defaultModel`, `aliases`, `outputDir`.
- `~/.config/wavespeed-nodejs/config.json` (via `conf`) — per-machine: `apiKey`, `baseUrl`, `defaultModel`, `aliases`.
- `WAVESPEED_API_KEY` env var — the only env var the CLI reads; overrides stored key.

**SDK boundary**: the official `wavespeed` npm SDK only covers `run()` and `upload()`. For `/api/v3/models` and `/api/v3/balance` we fetch directly.
