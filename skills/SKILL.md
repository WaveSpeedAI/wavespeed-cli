---
name: wavespeed
description: Generate or edit AI media (image, video, audio, 3D) by calling the wavespeed CLI on the user's machine. Use whenever the user asks to create, edit, animate, upscale, or transform a visual asset, generate audio/TTS/music, or produce marketing creatives. Every model on the WaveSpeed platform is one `wavespeed run <id>` call.
---

# WaveSpeed

You have access to the `wavespeed` CLI. Every generation flows through one verb. There are no `image` / `video` shortcuts; the model id is always explicit.

## The three-step pattern

```bash
# 1. FIND a model — search the live catalog
wavespeed models "nano banana"
wavespeed models --type image-to-video --popular

# 2. INSPECT its inputs — dynamic schema, per model
wavespeed run google/nano-banana-2/text-to-image -h

# 3. RUN it — always pass --json so you can read the result
wavespeed run google/nano-banana-2/text-to-image \
  -p "a cyberpunk skyline at golden hour" \
  -i aspect_ratio="16:9" -i resolution="2k" --json
```

`run --json` returns `{ model, prompt, outputs: [url, ...], saved: [path, ...], elapsed_ms, raw }`. Use the URL when the user wants a link. Add `--download` if they need bytes on disk.

## Recommended defaults

| Use case | Model |
|---|---|
| Text → image | `google/nano-banana-2/text-to-image` |
| Image edit (instruction-driven) | `google/nano-banana-2/edit` — requires `images: [url, ...]` |
| Text → video | `bytedance/seedance-2.0/text-to-video` |
| Image → video | `bytedance/seedance-2.0/image-to-video` — requires `image: url` |

These are good starting points. Browse alternatives with `wavespeed models <query>`.

## Common recipes

```bash
# Edit an existing image — upload first, then pass the URL
URL=$(wavespeed upload ./input.jpg --json | jq -r .url)
wavespeed run google/nano-banana-2/edit \
  -p "replace the background with a sunlit kitchen" \
  -i images="[\"$URL\"]" --json

# Image-to-video — same pattern
URL=$(wavespeed upload ./hero.jpg --json | jq -r .url)
wavespeed run bytedance/seedance-2.0/image-to-video \
  -p "subtle parallax, gentle wind" \
  -i image="$URL" -i duration=5 --json

# Save outputs locally with a template
wavespeed run ... -p "..." --download "./out/{index}.{ext}"
```

## Project config and aliases

If `wavespeed.json` exists (created by `wavespeed init`):

- **`defaultModel`** — lets `wavespeed run -p "…"` (no model arg) work.
- **Aliases** — named shortcuts that bundle model + default inputs. Run `wavespeed aliases` to see what's defined. `wavespeed run <alias> -h` shows the resolved schema. CLI `-i k=v` overrides alias defaults.

The CLI never modifies the user's prompt or inputs. What you typed is what hits the API.

## Auth

`wavespeed status` shows whether the user is signed in. If not, ask them to run `wavespeed login` (opens https://wavespeed.ai/accesskey). **Never** ask the user to paste an API key into the chat — the CLI handles it.

## Pitfalls

- Local file paths don't auto-upload — call `wavespeed upload` first to get a CDN URL.
- Don't invent model IDs. Always confirm via `wavespeed models` or `wavespeed schema <id>` before running.
- Use `--json` on every `run` so you can read `outputs[0]` programmatically.
