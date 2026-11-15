---
name: narrated-evidence
description: "Trigger: video narrado, narrar bug, narrar funcionalidad, video con voz, evidencia en video, demo narrada, narrated video. Record narrated screen videos of a feature or bug with the narrate CLI."
license: MIT
metadata:
  author: "jsilgado"
  version: "1.2"
---

## Activation Contract

Load when the user wants a video with voice that explains a feature or reproduces a bug, or when screenshots alone cannot show a flow (timing, sequence, state that changes). For a single static state, a screenshot is enough: do not record.

This skill drives the `narrate` CLI from https://github.com/jeider05/ai-video-evidence. It runs on the user's machine, so it needs an agent with a local terminal (Claude Code, Codex CLI, Cursor, Gemini CLI); a web-only chat cannot run it.

## Setup (first use)

Check each requirement and report what is missing before installing anything:

| Requirement | Check | Install (ask the user first) |
|---|---|---|
| Node 22+ | `node -v` | https://nodejs.org |
| ffmpeg + ffprobe on PATH | `ffmpeg -version`, `ffprobe -version` | OS package manager (`winget install ffmpeg`, `brew install ffmpeg`, `apt install ffmpeg`) |
| Google Chrome | open it, or `browser.channel` in the script | https://www.google.com/chrome |
| edge-tts (default voice) | `edge-tts --list-voices` | `pip install edge-tts` |
| `narrate` CLI | `narrate --help` | `npm install -g github:jeider05/ai-video-evidence`, then `npx playwright install ffmpeg` |

Never install without the user's confirmation, and never pipe a downloaded script into a shell.

## Hard Rules

- Write the script first (`narration.json`), validate it, then record. Never record and narrate by hand.
- One scene = one idea and one sentence or two. The voice must describe what is on screen in that scene, never what comes next.
- Narration language matches the audience; set `tts.voice` to match it. Default `es-CO-SalomeNeural` (Spanish); others: `es-CO-GonzaloNeural`, `en-US-AriaNeural`, `en-US-GuyNeural` (list all with `edge-tts --list-voices`).
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
| Native `<select>` popup, OS dialog, or the app needs the user's real ego-browser session | Experimental: `"recorder": "gdigrab"` (Windows + ego lite only). Before running: the user signs in to the app in ego, keeps monitor 1 free, and is ready to switch ego to task space `narrate-<name>` when the runner asks (ego keeps Agent windows hidden; the runner raises it with Win32 but ego only paints the selected space). Unattended run = use `playwright` |
| gdigrab script uses `call`/`actionsModule` or `waitForResponse` | Not supported (validation error): use a real backend or a local server (`examples/bug-demo/server.mjs`) and `waitFor` on the UI result |
| gdigrab run fails with "never became visible on screen" | The task-space window was hidden or covered. Ask the user to select the space in ego and rerun; do not claim or reuse the user's own space or tabs |
| Need mocking or complex steps | `actionsModule` with exported `async (page, ctx)` functions, called with `{ "call": "name" }` |
| Evidence step of a bug | Read `out/<name>/evidence.json` (failed responses, console errors) from a first run and put the real request/status in the `evidencia` callout |

## Execution Steps

1. Copy the matching template next to the work (for PRs: `pr-assets/<name>.json`) and fill `title`, `baseUrl`, scenes, selectors.
2. `narrate validate <file>`; fix every reported path.
3. If the app needs a session: with `playwright`, ask the user to run `narrate login <url> --save pr-assets/state.json`, then set `browser.storageState`. With `gdigrab`, the user signs in to the app in ego beforehand (`recorder: "gdigrab"`, short scenes, no `call`).
4. `narrate run <file>` (or `tts`, `record`, `assemble` separately; `assemble` alone re-renders without recording again).
5. Check the result: extract frames at scene starts (`scenes.json`) with `ffmpeg -ss <t> -frames:v 1` and look at them; confirm the audio with `volumedetect`; read `evidence.json` (empty with gdigrab). With gdigrab, confirm the frames show only the page (no desktop, taskbar or other window on top).
6. Deliver `<name>.mp4` (H.264 + AAC + soft subtitles) and `<name>.srt`. For PRs: keep them in `pr-assets/` (out of git), attach them to the PR and list them in the description; if the project has its own PR-evidence skill, follow it.

## Action reference

`goto` (relative to `baseUrl`), `click`, `hover`, `check` (selector), `fill`/`select` `{selector, value}`, `press` `{key, selector?}`, `scroll` `{selector? | y?}`, `wait` (ms), `waitFor` (selector or `{selector, state, timeoutMs}`), `waitForResponse` (URL substring, also accepts a response already seen in the scene), `overlay` `{kind: actual|expected|info, title?, text | html, durationMs?}`, `screenshot` (name), `call` (export of `actionsModule`). Selectors are Playwright locators (`#id`, `text=Guardar`, `role=button[name="Guardar"]`). With `recorder: "gdigrab"` selectors go to ego as-is: raw CSS, `text=...`, `loc=role:button[name='Guardar']`, `@ref`; `call` and `waitForResponse` are rejected; `check`, `scroll {selector}` and `waitFor` use `page.evaluate`/`waitForFunction` for raw CSS selectors.

Scene fields: `id` (slug), `say`, `chapter` `{title, description?, durationMs?}`, `actions`, `speedup`. Top level: `title`, `baseUrl`, `recorder` (`playwright` | `gdigrab`), `gdigrab` `{framerate: 25, drawMouse: true, tab: "new"}`, `viewport` (Playwright only), `tts` `{engine: edge|deepgram|sapi, voice, rate, fallback}`, `browser` `{channel, headless, locale, storageState}`, `captions`, `showActions`, `gapMs`, `actionsModule`, `output`.

## Output Contract

Return: video path and duration, SRT path, TTS engine used (and any fallback), scenes with their start times, what `evidence.json` captured, and anything that could not be shown (native popups, flaky steps).

## References

- `assets/bug-template.json`, `assets/feature-template.json` — script skeletons.
- https://github.com/jeider05/ai-video-evidence `README.md` — install, commands, how sync works.
- `examples/bug-demo/` in the repository — complete working example with a mocked backend (`narration.json`, Playwright) and the gdigrab variant (`narration-ego.json` + `server.mjs`).
