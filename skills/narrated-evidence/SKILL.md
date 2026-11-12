---
name: narrated-evidence
description: "Trigger: video narrado, narrar bug, narrar funcionalidad, video con voz, evidencia en video, demo narrada, narrated video. Record narrated screen videos of a feature or bug with the narrate CLI."
license: Apache-2.0
metadata:
  author: "jsilgado"
  version: "1.0"
---

## Activation Contract

Load when the user wants a video with voice that explains a feature or reproduces a bug, or when screenshots alone cannot show a flow (timing, sequence, state that changes). For a single static state, a screenshot is enough: do not record.

The CLI lives in `C:\Users\DESARROLLADORES\Documents\personal\ai-video-evidence` (`node bin/narrate.mjs`). It needs Node 22+, ffmpeg/ffprobe on PATH, Google Chrome, and `pip install edge-tts`.

## Hard Rules

- Write the script first (`narration.json`), validate it, then record. Never record and narrate by hand.
- One scene = one idea and one sentence or two. The voice must describe what is on screen in that scene, never what comes next.
- Narration language matches the audience (Spanish for Trip2 PRs). Voice default `es-CO-SalomeNeural`; male: `es-CO-GonzaloNeural`.
- Never type passwords. For authenticated apps, the user runs `narrate login <url>` and signs in; point `browser.storageState` at the saved file. Delete that file after recording, and keep it out of git.
- Use only test data the user confirmed. New records get a `QA_` prefix; never edit or delete existing records.
- Keep outputs out of git (`out/`, `pr-assets/`).
- Nondeterministic flows (LLM, async jobs): check the outcome in the recorded frames. If the app did something else than the narration says, record again; never ship a video whose voice contradicts the screen.

## Decision Gates

| Situation | Action |
|---|---|
| Bug report | `assets/bug-template.json`: contexto → pasos → actual (red callout) → esperado (green) → evidencia → impacto |
| Feature / PR demo | `assets/feature-template.json`: qué resuelve → recorrido → casos borde |
| Backend wait or slow load | Put it in its own scene with `"speedup": 4`; only the part after the narration is accelerated |
| Native `<select>` popup or the user's live ego-browser session must appear | Playwright cannot show it; say so and use screenshots or an ffmpeg gdigrab capture instead |
| Need mocking or complex steps | `actionsModule` with exported `async (page, ctx)` functions, called with `{ "call": "name" }` |
| Evidence step of a bug | Read `out/<name>/evidence.json` (failed responses, console errors) from a first run and put the real request/status in the `evidencia` callout |

## Execution Steps

1. Copy the matching template next to the work (Trip2: `pr-assets/<name>.json`) and fill `title`, `baseUrl`, scenes, selectors.
2. `node bin/narrate.mjs validate <file>`; fix every reported path.
3. If the app needs a session: ask the user to run `node bin/narrate.mjs login <url> --save pr-assets/state.json`, then set `browser.storageState`.
4. `node bin/narrate.mjs run <file>` (or `tts`, `record`, `assemble` separately; `assemble` alone re-renders without recording again).
5. Check the result: extract frames at scene starts (`scenes.json`) with `ffmpeg -ss <t> -frames:v 1` and look at them; confirm the audio with `volumedetect`; read `evidence.json`.
6. Deliver `<name>.mp4` (H.264 + AAC + soft subtitles) and `<name>.srt`. For Trip2 PRs follow `trip2-pr-delivery`: artifacts in `pr-assets/`, attached to the PR, listed in the description.

## Action reference

`goto` (relative to `baseUrl`), `click`, `hover`, `check` (selector), `fill`/`select` `{selector, value}`, `press` `{key, selector?}`, `scroll` `{selector? | y?}`, `wait` (ms), `waitFor` (selector or `{selector, state, timeoutMs}`), `waitForResponse` (URL substring, also accepts a response already seen in the scene), `overlay` `{kind: actual|expected|info, title?, text | html, durationMs?}`, `screenshot` (name), `call` (export of `actionsModule`). Selectors are Playwright locators (`#id`, `text=Guardar`, `role=button[name="Guardar"]`).

Scene fields: `id` (slug), `say`, `chapter` `{title, description?, durationMs?}`, `actions`, `speedup`. Top level: `title`, `baseUrl`, `viewport`, `tts` `{engine: edge|deepgram|sapi, voice, rate, fallback}`, `browser` `{channel, headless, locale, storageState}`, `captions`, `showActions`, `gapMs`, `actionsModule`, `output`.

## Output Contract

Return: video path and duration, SRT path, TTS engine used (and any fallback), scenes with their start times, what `evidence.json` captured, and anything that could not be shown (native popups, flaky steps).

## References

- `assets/bug-template.json`, `assets/feature-template.json` — script skeletons.
- Repository `README.md` — install, commands, how sync works.
- `examples/bug-demo/` — complete working example with a mocked backend.
