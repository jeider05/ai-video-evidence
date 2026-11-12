# ai-video-evidence

Narrated video evidence (voice + screen) for features and bugs. You write a `narration.json` script, and `narrate` synthesizes the voice, records the browser with Playwright and assembles an MP4 with audio and subtitles.

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

## Commands

| Command | What it does | Writes to `out/<name>/` |
|---|---|---|
| `validate <file>` | Checks the script and lists its scenes | nothing |
| `tts <file>` | Synthesizes each scene's `say` | `tts.json` (audio cached in `.cache/tts/`) |
| `record <file>` | Records the scenes in headless Chrome | `recording.webm`, `scenes.json`, `evidence.json`, screenshots |
| `assemble <file>` | Mixes audio, speed-ups and captions | `<name>.mp4`, `<name>.srt` |
| `run <file>` | `tts` + `record` + `assemble` | all of the above |
| `login <url> [--save f]` | Opens Chrome for a manual sign-in and saves the session | `.cache/auth/state.json` |

`--out <dir>` changes the working directory; `output` in the script changes the final MP4 path. Exit codes: `0` ok, `1` error, `2` usage.

## How sync works

1. The voice is generated **before** recording, and each clip's duration is measured with ffprobe.
2. While recording, each scene runs its actions and then waits until its narration (plus `gapMs`, 400 ms by default) has played, so the voice never runs ahead. The real start of each scene is saved in `scenes.json`.
3. `assemble` cuts the recording per scene, accelerates only the part after the narration in scenes with `speedup`, places each clip at the scene start (`adelay` + `amix`) and encodes H.264 + AAC with soft subtitles (`mov_text`). The same cues go to the `.srt`.

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
- Recording a live ego-browser window with ffmpeg gdigrab is not implemented yet.
