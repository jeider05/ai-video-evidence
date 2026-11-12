# narrated-evidence

Reusable pipeline so the agent can produce narrated videos (voice + screen) of a feature or a bug, not only screenshots.
Playwright headless recording first; ffmpeg gdigrab over ego-browser stays a later alternative mode.

## Specs

- S1 — "un CLI chico en Node (`narrate record|tts|assemble`) con el pipeline de arriba, generalizando lo de EMScribe".
- S2 — Script: "`narration.json`: una lista de escenas `{id, texto, acciones}`."
- S3 — Voice: "edge-tts como opción por defecto y Deepgram como respaldo" (Windows SAPI Helena "solo como último recurso"). Voices: `es-CO-SalomeNeural`, `es-CO-GonzaloNeural`.
- S4 — "Generá el audio **antes** de grabar": "TTS por escena y medición de cada duración con `ffprobe`."
- S5 — "cada escena ejecuta sus acciones y espera **lo que sea más largo entre las acciones y el audio**, para que la voz nunca quede adelantada. Se guarda el timestamp real de inicio de cada escena."
- S6 — Recording with Playwright ≥1.59 `page.screencast`: "`showChapter()` pone tarjetas de título con fondo difuminado, `showActions()` resalta cada click con un cursor animado y `showOverlay(html)` permite subtítulos o un recuadro tipo "Esperado vs Actual"."
- S7 — "ffmpeg ubica cada clip de audio en su timestamp (`adelay` + `amix`) y codifica en H.264 + AAC. Los tiempos muertos, como esperar al backend, se aceleran con `setpts`."
- S8 — "un `.srt` generado del mismo guion, para quien mire el video sin sonido en el PR."
- S9 — Bug script template: "contexto → pasos → **esperado vs actual**, con un overlay rojo en el momento exacto → evidencia (request o consola) → impacto". Feature template: "qué resuelve → recorrido → casos borde".
- S10 — "una **skill `narrated-evidence`** que me diga cuándo y cómo usarlo, cómo escribir el guion de bug o feature, y que se conecte con `trip2-pr-delivery`."
- S11 — Login: Playwright headless where "el login se hace inyectando la sesión".

- S12 — gdigrab mode: "grabaría la **ventana real de ego-browser**, con tu sesión ya logueada, mientras yo la manejo"; "un `"recorder": "gdigrab"` en el guion. Usaría el mismo sistema de escenas, voz y ensamblado, pero cambiaría la fuente del video."
- S13 — gdigrab lacks Playwright overlays ("Chapters, cursor animado, recuadros ... No vienen incluidos; habría que inyectarlos en la página"); must account for display scaling ("en tu monitor al 125%: viewport 1536×672 ↔ 1920×840 físicos").
- S14 — Then: "despues hacemos una pureb con una narracion breve de trip2".

## Tasks

- T1 — S2,S4,S5,S7,S8 — inline — core pure modules (schema validation, timeline, ffmpeg graph, SRT) with node:test — commit: 64791d6 (done)
- T2 — S1,S3,S4 — inline — `narrate tts` with edge → deepgram → sapi fallback and cache — commit: 64791d6 (done)
- T3 — S1,S5,S6,S11 — inline — `narrate record` (Playwright screencast, chapters, actions, overlays, captions, storageState) — commit: 76bcb71 (done)
- T4 — S1,S7,S8 — inline — `narrate assemble` + `narrate run` end-to-end — commit: 76bcb71 (done)
- T5 — S9 — inline — demo example (local page with a fake bug) and end-to-end video check — commit: 76bcb71 (done)
- T6 — S9,S10 — inline — skill `skills/narrated-evidence/SKILL.md`, templates, README — commit: 04b5e66 (done)

- T7 — S12,S13 — worker — gdigrab recorder driving ego-browser (runner via `ego-browser nodejs`, region capture, DOM overlays) + tests + docs — commit: 194471b (implemented; live capture unverified)
- T8 — S14 — inline — brief Trip2 narration trial in ego-browser — commit: n/a

## Log

- L1 — User (2026-11-12): "como podemos hacer para que ademas de tomar evidencia con fotos tambien puedas narrar una funcionalidad o un bug ? investiga"
- L2 — User accepted the proposal ("si esta bien"): Playwright headless first, gdigrab as a later alternative mode; CLI + skill in this folder.
- L3 — Verified 2026-11-12: 15/15 unit tests; bug demo end-to-end (55.0s recording -> 49.6s MP4, h264+aac+mov_text, mean -21.7 dB); frames checked. Added `narrate login` (storageState) for S11. Deepgram not exercised (no key). gdigrab mode deferred.
- L4 — User (2026-11-12): "antes del sigueinte paso neecsito una documentcion con el flujo como tal y tecnologias  y una documentaicion del flujo del codigo osea serian dos docuemntoos" -> docs/workflow.md, docs/code-flow.md (worker, English).
- L5 — User (2026-11-12): "ok implrmnatlo y despues hacemos una pureb con una narracion breve de trip2" (after confirming gdigrab is free).
- L6 — T7 worker result 2026-11-12: 29/29 tests, Playwright regression OK (49.92s MP4). Live gdigrab FAILED unattended: ego 0.6.2.7 keeps agent space windows hidden/unpainted even after ShowWindow; runner now waits 60s for the user to select space narrate-<name>. S13 covered, S12 pending an attended run.
