// High-level commands shared by the CLI: load, tts, record, assemble, run.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { validateNarration } from './schema.mjs';
import { synthesizeScenes } from './tts.mjs';
import { buildTimeline } from './timeline.mjs';
import { toSrt } from './srt.mjs';
import { buildAssembleArgs, probeDuration, run } from './ffmpeg.mjs';

export function load(narrationPath, { out } = {}) {
  const file = resolve(narrationPath);
  const raw = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${narrationPath}: invalid JSON (${e.message})`);
  }
  const narration = validateNarration(json);
  const baseDir = dirname(file);
  const name = basename(file, extname(file));
  const workDir = resolve(out ?? join(baseDir, 'out', name));
  mkdirSync(workDir, { recursive: true });
  const output = narration.output ? resolve(baseDir, narration.output) : join(workDir, `${name}.mp4`);
  return { narration, file, baseDir, workDir, output, cacheDir: join(baseDir, '.cache', 'tts') };
}

const readJson = (path, hint) => {
  if (!existsSync(path)) throw new Error(`${path} not found; run "${hint}" first`);
  return JSON.parse(readFileSync(path, 'utf8'));
};

export async function tts(job, log) {
  const manifest = await synthesizeScenes(job.narration, { cacheDir: job.cacheDir, log });
  writeFileSync(join(job.workDir, 'tts.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

/** Video file written by `record`, named in scenes.json (runs before T7 had no field: recording.webm). */
export const recordedVideo = (marks) => marks.video ?? 'recording.webm';

export async function record(job, log) {
  if (job.narration.recorder === 'gdigrab') {
    const { recordGdigrab } = await import('./gdigrab.mjs');
    return recordGdigrab(job, log);
  }
  const { recordScenes } = await import('./record.mjs');
  const manifest = readJson(join(job.workDir, 'tts.json'), 'narrate tts');
  return recordScenes(job.narration, { baseDir: job.baseDir, workDir: job.workDir, tts: manifest, log });
}

/** Headed Chrome for a manual sign-in; saves storageState every second until the window closes. */
export async function login(url, save, log) {
  const { chromium } = await import('playwright');
  const file = resolve(save);
  mkdirSync(dirname(file), { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  await page.goto(url);
  log(`login: sign in on the opened window, then close it. Saving to ${file}`);
  let saved = false;
  while (browser.isConnected() && context.pages().length > 0) {
    try {
      await context.storageState({ path: file });
      saved = true;
    } catch {
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await browser.close().catch(() => {});
  if (!saved) throw new Error('login: no session was saved');
  log(`login: saved ${file}`);
}

export async function assemble(job, log) {
  const manifest = readJson(join(job.workDir, 'tts.json'), 'narrate tts');
  const marks = readJson(join(job.workDir, 'scenes.json'), 'narrate record');
  const video = join(job.workDir, recordedVideo(marks));
  const total = Math.min(marks.total, await probeDuration(video));

  const byId = new Map(job.narration.scenes.map((s) => [s.id, s]));
  const scenes = marks.scenes.map((m) => {
    const s = byId.get(m.id);
    if (!s) throw new Error(`scenes.json: scene "${m.id}" is not in the narration; record again`);
    return { id: m.id, start: m.start, say: s.say, speedup: s.speedup, audio: manifest[m.id] };
  });
  const timeline = buildTimeline({ total, scenes });

  const srt = job.output.replace(/\.mp4$/i, '') + '.srt';
  writeFileSync(srt, toSrt(timeline.cues));
  mkdirSync(dirname(job.output), { recursive: true });
  await run('ffmpeg', buildAssembleArgs({ video, segments: timeline.segments, audios: timeline.audios, srt, output: job.output }));
  log(`assemble: ${job.output} (${timeline.duration.toFixed(1)}s) + ${basename(srt)}`);
  return { output: job.output, srt, duration: timeline.duration };
}
