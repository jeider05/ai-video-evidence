# ai-video-evidence

Narrated video evidence (voice + screen) for features and bugs. You write a `narration.json` script, and `narrate` synthesizes the voice, records the browser (headless Playwright by default, or the real ego-browser window with ffmpeg gdigrab) and assembles an MP4 with audio and subtitles.

## Install

Requirements: Node 22+, ffmpeg and ffprobe on PATH, Google Chrome, Python with edge-tts.

```bash
npm install
npx playwright install ffmpeg   # Playwright's screencast encoder (Chrome itself is used as the browser)
pip install edge-tts
npm test
```

## Quick start

```bash
node bin/narrate.mjs run examples/bug-demo/narration.json
# -> examples/bug-demo/out/narration/narration.mp4 + narration.srt
```

## Documentation

| Doc | Read it to |
|---|---|
| [docs/workflow.md](docs/workflow.md) | Understand the end-to-end process, the technologies, the artifacts and the security rules |
| [docs/code-flow.md](docs/code-flow.md) | Maintain or extend the code: module map, call paths, timeline math, how to add actions or TTS engines |

## Commands

| Command | What it does | Writes to `out/<name>/` |
|---|---|---|
| `validate <file>` | Checks the script and lists its scenes | nothing |
| `tts <file>` | Synthesizes each scene's `say` | `tts.json` (audio cached in `.cache/tts/`) |
| `record <file>` | Records the scenes with the script's `recorder` | Playwright: `recording.webm`, `scenes.json`, `evidence.json`, screenshots. gdigrab: `recording.mp4`, `scenes.json`, `evidence.json` (empty), screenshots |
| `assemble <file>` | Mixes audio, speed-ups and captions | `<name>.mp4`, `<name>.srt` |
| `run <file>` | `tts` + `record` + `assemble` | all of the above |
| `login <url> [--save f]` | Opens Chrome for a manual sign-in and saves the session | `.cache/auth/state.json` |

`--out <dir>` changes the working directory; `output` in the script changes the final MP4 path. Exit codes: `0` ok, `1` error, `2` usage.

## How sync works

1. The voice is generated **before** recording, and each clip's duration is measured with ffprobe.
2. While recording, each scene runs its actions and then waits until its narration (plus `gapMs`, 400 ms by default) has played, so the voice never runs ahead. The real start of each scene is saved in `scenes.json`.
3. `assemble` cuts the recording per scene, accelerates only the part after the narration in scenes with `speedup`, places each clip at the scene start (`adelay` + `amix`) and encodes H.264 + AAC with soft subtitles (`mov_text`). The same cues go to the `.srt`.

## Recorders

| `recorder` | Video source | Use it when | Needs |
|---|---|---|---|
| `playwright` (default) | Headless Chrome `page.screencast` | Most demos and bugs; unattended runs | Chrome, `npx playwright install ffmpeg` |
| `gdigrab` | ego-browser drives the page; `ffmpeg -f gdigrab` grabs its screen area | Native popups, or the app needs the user's real ego session | Windows, ego lite, the task-space window visible and unobstructed |

Options for gdigrab: `"gdigrab": { "framerate": 25, "drawMouse": true, "tab": "new" }` (only `"new"`: the runner works in its own ego task space and never touches your tabs). Not supported with gdigrab: `call`/`actionsModule` and `waitForResponse` (validation error). Captions, callouts and chapter cards are injected into the page DOM (`pointer-events:none`, top z-index) and re-mounted after every `goto`.

How a gdigrab run works: `narrate record` writes `out/<name>/ego-input.json` + `ego-entry.mjs` and runs `ego-browser nodejs`. The runner (`src/ego-runner.mjs`) opens a task space named `narrate-<name>`, loads the first `goto`, raises the space window (Win32 `ShowWindow`), paints the viewport magenta and grabs one frame to find the exact page rectangle, then records it with `libx264` while it plays the scenes. Start times count from ffmpeg spawn + 800 ms (approximation, see docs/code-flow.md). Try it with the demo server:

```bash
node examples/bug-demo/server.mjs &          # http://127.0.0.1:4310/
node bin/narrate.mjs run examples/bug-demo/narration-ego.json
```

## Voice

| Engine | Use | Config |
|---|---|---|
| `edge` (default) | Free neural voices; needs internet. Spanish (Colombia): `es-CO-SalomeNeural`, `es-CO-GonzaloNeural` | `pip install edge-tts`; `NARRATE_PYTHON` picks the Python |
| `deepgram` | Paid fallback, `aura-2-celeste-es` | `DEEPGRAM_API_KEY` or `DEEPGRAM_API_KEY_FILE` |
| `sapi` | Offline last resort (Windows), `Microsoft Helena Desktop` | none |

With `tts.fallback` (on by default), a failing engine falls through to the next one. Deepgram is skipped when no key is set.

## Script

See `skills/narrated-evidence/SKILL.md` for the full action reference, and the bug and feature templates in `skills/narrated-evidence/assets/`. `examples/bug-demo/` is a complete example that mocks its backend with `page.route` through an `actionsModule`.

## Limits

- Playwright cannot show native `<select>` popups or OS dialogs.
- The recorded session is a fresh headless browser. Use `narrate login` + `browser.storageState` for apps that need a session. The state file holds a live session: keep it out of git and delete it after recording.
- Recorder gdigrab is Windows only and grabs **the screen**: the ego window must be on the primary monitor, visible and not covered for the whole run. Anything on top of it is recorded.
- ego lite (0.6.2.7) keeps Agent task-space windows hidden; only the space selected in its UI is shown. The runner shows the window with Win32 `ShowWindow`, but ego does not paint it that way: in our tests the frame stayed dark until the space is selected in ego. The runner then waits 60 s, asking you to switch ego to space `narrate-<name>`, and fails if the page never appears. Forcing the window visible can leave ego's space switcher out of sync until you click a space.
- gdigrab mode collects no `evidence.json` (no network/console listeners): read the evidence from a Playwright run or the DevTools of ego.
- Never type passwords in gdigrab mode either: sign in to the app in ego beforehand; the runner's task space opens in your default ego profile (not yet verified against a real login).
