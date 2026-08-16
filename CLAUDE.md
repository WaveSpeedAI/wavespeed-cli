# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run dev -- <subcommand> [args]   # run from source via tsx (no build needed)
npm run build                         # tsc → dist/
npm run lint                          # tsc --noEmit
npm test                              # vitest run (unit tests for pure helpers)
npm run test:smoke                    # `tsx src/cli.ts --version` — boots the CLI
npm run format                        # prettier on src/**/*.ts
```

Tests use Vitest and live in `src/**/*.test.ts` alongside the code they cover (excluded from the `tsc` build via `tsconfig.json`'s `exclude`). Add new tests for pure helpers when you touch them. End-to-end command behavior is still verified against `api.wavespeed.ai` with a real API key in a scratch directory — vitest only covers logic, not the HTTP surface.

## Architecture

**One generation verb.** `wavespeed run <model_id|alias>` is the only generate command. Everything else is auxiliary (auth, catalog browse, schema, upload/download, project config).

**Two invariants that span multiple files:**

1. **JSON-first stdout protocol** (`src/lib/log.ts`). When `--json` is set, stdout is reserved for the final JSON payload only; progress, spinners, and human text go to stderr. Use `setJsonMode/log/emitJson/emitJsonError` in any new command.

2. **The CLI never mutates user input.** What the user passes is what hits the API. Don't add silent prompt prefixes, palette injections, or style suffixes. The two explicit mechanisms that transform input are aliases (named bundles of extra inputs) and the `@path` marker (`src/lib/local-files.ts`), which uploads the referenced file and substitutes its hosted URL. Never widen `@` into heuristic auto-detection of bare paths — that was tried and deliberately reverted.

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
- Env vars: `WAVESPEED_API_KEY` (overrides stored key) and `WAVESPEED_BASE_URL` (overrides stored base URL).

**SDK boundary**: the official `wavespeed` npm SDK is used for `upload()` only; `run` submits and polls itself (`submitPrediction`/`waitForPrediction` in `src/lib/api.ts`) so the prediction ID is visible from the moment it exists. Direct calls cover `/api/v3/models`, `/api/v3/balance`, `/api/v3/model/price`, `/api/v3/predictions`, `/api/v3/predictions/<id>/result`, `/api/v3/predictions/delete`, `/api/v3/billings/search`, and `/api/v3/user/usage_stats`. Every endpoint the CLI touches must be v3 AND documented in the public api-doc — no internal or legacy contracts.

**Useful page URLs** live in `src/lib/links.ts` — a single map consumed by `wavespeed open` and the `status` footer. Adding/renaming a link is a one-file change.
