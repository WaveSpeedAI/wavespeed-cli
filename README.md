<div align="center">
  <a href="https://wavespeed.ai" target="_blank">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/wavespeed-logo-dark.svg">
      <img src="assets/wavespeed-logo-light.svg" alt="WaveSpeed" width="342" height="48"/>
    </picture>
  </a>

  <h1>WaveSpeed CLI</h1>
  <p><strong>One command, every WaveSpeed model. Image, video, audio, 3D — from your terminal.</strong></p>
  <p>
    <a href="https://wavespeed.ai">🌐 wavespeed.ai</a> •
    <a href="https://wavespeed.ai/cli">💻 wavespeed.ai/cli</a> •
    <a href="https://wavespeed.ai/models">📚 Models</a> •
    <a href="https://wavespeed.ai/docs">📖 Docs</a> •
    <a href="https://github.com/WaveSpeedAI/wavespeed-cli/issues">🐛 Issues</a>
  </p>
  <p>
    <a href="https://www.npmjs.com/package/@wavespeed/cli"><img alt="npm" src="https://img.shields.io/npm/v/@wavespeed/cli?style=flat-square&color=7c5cff"></a>
    <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-7c5cff?style=flat-square"></a>
    <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A518-7c5cff?style=flat-square">
  </p>
</div>

---

## Features

- 🚀 **Every WaveSpeed model** — image, video, audio, 3D; the full live catalog, not a curated subset
- 🧬 **Dynamic per-model help** — `wavespeed run <id> -h` introspects the real input schema
- 🔗 **Aliases** — named shortcuts in `wavespeed.json` that bundle a model + default inputs
- 🤖 **Agent-native** — pipe-safe `--json`, drops a `SKILL.md` for Claude Code / Cursor / Codex
- ✨ **Zero-friction auth** — browser-launching, clipboard-aware login with live key validation

## Install

```bash
# npm
npm install -g @wavespeed/cli

# or curl (script lives on GitHub; wraps `npm install -g` with a
# friendlier error path)
curl -fsSL https://raw.githubusercontent.com/WaveSpeedAI/wavespeed-cli/main/install.sh | bash

# sign in (opens the access-key page, paste to confirm)
wavespeed login
```

## Quick start

```bash
# 1. Browse the catalog
wavespeed models                              # browse the full live catalog, grouped by type
wavespeed models "z-image"                    # search
wavespeed models --type text-to-video         # filter by modality

# 2. Inspect a model's inputs (dynamic — fetched live)
wavespeed run wavespeed-ai/z-image/turbo -h

# 3. Run it (URLs print to stdout; no files unless you ask).
#    z-image/turbo returns in ~5s, a good default for trying the CLI.
wavespeed run wavespeed-ai/z-image/turbo \
  -p "a cyberpunk skyline at golden hour"

# Save outputs locally
wavespeed run ... -p "..." --download                       # → ./wavespeed-output/
wavespeed run ... -p "..." --download "./hero.png"          # exact path
wavespeed run ... -p "..." --download "./out/{index}.{ext}" # templated for batches

# Pipe-safe JSON
wavespeed run ... -p "..." --json | jq '.outputs[0]'
```

## Project config (`wavespeed.json`)

`wavespeed init` writes one. Drop it into git so the whole team shares the same defaults.

```jsonc
{
  "defaultModel": "bytedance/seedream-v5.0-pro",
  "outputDir": "wavespeed-output",
  "aliases": {
    "hero":   { "model": "bytedance/seedream-v5.0-pro",
                "input": { "aspect_ratio": "16:9", "resolution": "2k" } },
    "social": { "model": "bytedance/seedream-v5.0-pro",
                "input": { "aspect_ratio": "1:1",  "resolution": "1k" } },
    "vid":    { "model": "wavespeed-ai/minimax-h3/text-to-video",
                "input": { "resolution": "768p", "duration": 5 } }
  }
}
```

- **`defaultModel`** — `wavespeed run -p "…"` (no model arg) uses this. Can itself be an alias name.
- **`aliases`** — your own shortcuts. `wavespeed run hero -p "…"` expands to model + input. CLI `-i k=v` flags override. `wavespeed run hero -h` shows the resolved schema. List them with `wavespeed aliases`.

Resolution: positional with `/` is a model ID; otherwise looked up as an alias. Merge order on inputs: `alias.input` → `--input-file` → `-i k=v` → `-p`. **The CLI never rewrites your prompt or input values.** The one way to hand it a local file is the explicit `@` marker below — bare paths are passed through untouched, never uploaded.

**Local files as inputs.** `-i image=@./cat.png` (curl-style) uploads the file and submits its hosted URL — no separate `wavespeed upload` step. Only `@`-prefixed values upload; a missing `@` file is an error. Identical bytes are content-hash cached for 24h, so repeated runs (and `price --upload`) reuse one upload and spare your quota.

## Recommended starting models

| Use case | Model |
|---|---|
| Text → image | `bytedance/seedream-v5.0-pro` |
| Image edit | `bytedance/seedream-v5.0-pro/edit` |
| Text → video | `wavespeed-ai/minimax-h3/text-to-video` |
| Image → video | `wavespeed-ai/minimax-h3/image-to-video` |
| Video edit | `wavespeed-ai/minimax-h3/video-edit` |
| Video extend | `wavespeed-ai/minimax-h3/video-extend` |

MiniMax H3 is the open-weights default: cheap, fast, and native stereo audio — the best place to start. When you need the highest quality, switch to `bytedance/seedance-2.5/*` (text-to-video, image-to-video, video-edit, video-extend). Browse alternatives with `wavespeed models <query>`.

## Use from coding agents

No MCP server, no daemon. The CLI **is** the interface — agents already know how to run shell commands.

```bash
wavespeed skill install        # writes .claude/skills/wavespeed/SKILL.md
```

The skill teaches the agent the three-step pattern: `models` to find, `run <id> -h` to discover params, `run <id> -p "…" --json` to execute. Every command supports `--json` for clean piping.

**OpenCode** loads the same file with no extra steps — `.claude/skills/` is on its skill search path.

**DeepSeek Harness (dsh)**: the same skill is packaged for dsh's `.dsh/skills` layout at [WaveSpeedAI/wavespeed-dsh-skill](https://github.com/WaveSpeedAI/wavespeed-dsh-skill).

**Kimi Code CLI** reads `.claude/skills/` too, so `wavespeed skill install` is enough. For a one-line install that also wires up the MCP server, use the plugin: `/plugins install https://github.com/WaveSpeedAI/wavespeed-kimi-plugin` ([WaveSpeedAI/wavespeed-kimi-plugin](https://github.com/WaveSpeedAI/wavespeed-kimi-plugin)).

## Commands

```
# auth & config
wavespeed login                          Browser + paste-key wizard (clipboard-aware)
wavespeed logout                         Clear stored API key
wavespeed status                         Show masked key, base URL, useful links
wavespeed config [--default-model …]     View / update CLI defaults

# generation
wavespeed run [model|alias] -p "…"       Run any model or alias (uses defaultModel if omitted)
wavespeed run <model|alias> --sync       Attempt sync wait; timed-out tasks remain queryable
wavespeed run <model|alias> -h           Dynamic schema-based help (alias-aware)
wavespeed schema <model>                 Pretty-print a model's input schema
wavespeed models [query]                 Browse the live catalog (cached 1h)
wavespeed aliases                        List aliases from wavespeed.json + user config

# files
wavespeed upload <file...>               Upload local file(s) → CDN URLs (24h dedup cache)
wavespeed download <url...>              Save URLs to disk

# account & history
wavespeed balance                        Show your current credit balance
wavespeed usage [--since --until]        Spend + request counts, per-model (last 7d)
wavespeed billings [--type --since …]    Itemized charges and refunds
wavespeed price <model> -i k=v           Estimate the cost of a run (no charge)
wavespeed top-up                         Open https://wavespeed.ai/top-up
wavespeed history [--limit --status …]   List recent predictions (last 24h)
wavespeed show <id>                      Full details for a past prediction
wavespeed delete <id...>                 Remove predictions from your history

# misc
wavespeed open [target]                  Jump to dashboard / models / docs / … in browser
wavespeed init                           Create a wavespeed.json with defaults + alias stubs
wavespeed skill install                  Drop SKILL.md for coding agents
```

**Pricing is an estimate.** `wavespeed price` quotes from the model's pricing
formula, and many models bill from an input — audio/video duration, frame count,
text length. Those inputs are optional in the quote: ask for a price without
them and the formula collapses to the model's **base price**, which is the floor
of its range, not a typical run. `wavespeed price wavespeed-ai/infinitetalk`
says `$0.15`; a 60s audio actually bills `$1.80`. The command names the inputs it
was blind to (`unpriced_inputs` / `at_base_price` in `--json`) — supply them for
a real quote. Whatever it says, the amount actually charged for a run is
authoritative.

## Auth

| | Use when |
|---|---|
| `wavespeed login` | Persistent, one machine, one user. Stored in `~/.config/wavespeed-nodejs/config.json`. |
| `WAVESPEED_API_KEY=… wavespeed run …` | CI, scripts, one-off shells. Env var wins over stored config. |

Get a key at [wavespeed.ai/accesskey](https://wavespeed.ai/accesskey).

## Development

```bash
git clone https://github.com/WaveSpeedAI/wavespeed-cli.git
cd cli
npm install
npm run dev -- run wavespeed-ai/z-image/turbo -p "a serene mountain lake"
npm run build && npm link
```

Stack: TypeScript, Commander, Inquirer, Chalk, Ora, the official `wavespeed` SDK.

## License

MIT — see [LICENSE](LICENSE).

---

**[WaveSpeed AI](https://wavespeed.ai/)** — AI image & video generation platform.
Try it in the browser: **[Image generator](https://wavespeed.ai/image-generator)** · **[Video generator](https://wavespeed.ai/video-generator)**
