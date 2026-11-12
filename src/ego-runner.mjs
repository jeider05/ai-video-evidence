// Runs INSIDE `ego-browser nodejs` (recorder "gdigrab"); started by recordGdigrab() in gdigrab.mjs.
// Uses only the documented ego API through the global taskSpace(): task.pages/newPage/finish,
// page.goto/click/fill/hover/press/selectOption/waitForFunction/waitForSelector/evaluate/screenshot,
// page.mouse/keyboard. Inputs come from a JSON file (ego does not inherit argv or the shell environment).
// Never types passwords: when the app needs a session, sign in to ego beforehand.

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { validateNarration } from './schema.mjs';
import {
  buildFrameGrabArgs, buildGdigrabArgs, contentRegion, detectRegion, isCssSelector, showWindowScript, windowArea,
} from './gdigrab.mjs';
import { calibrationHtml, calloutHtml, captionHtml, chapterHtml, domOverlay } from './overlays.mjs';

/** Wait after spawning ffmpeg before the first scene; scene marks count from spawn + this delay. */
const START_DELAY_MS = 800;
/** How long to wait for the task-space window to become visible and painted. */
const VISIBLE_TIMEOUT_MS = 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round3 = (n) => Math.round(n * 1000) / 1000;
const log = (msg) => console.log(`[ego] ${msg}`);

export async function main(inputPath) {
  const input = JSON.parse(readFileSync(inputPath, 'utf8'));
  const narration = validateNarration(JSON.parse(readFileSync(input.narrationPath, 'utf8').replace(/^﻿/, '')));
  const tts = JSON.parse(readFileSync(input.ttsPath, 'utf8'));
  const workDir = input.workDir;
  const ffmpegBin = input.ffmpeg ?? 'ffmpeg';

  const task = await globalThis.taskSpace(input.spaceName);
  let capture = null;
  try {
    log(`task space "${task.name}" (id ${task.spaceId})`);
    // A new space already has a blank p1: use it instead of opening a second Page.
    const pages = await task.pages();
    const page = pages.length ? pages[0] : await task.newPage();

    const firstGoto = narration.scenes.flatMap((s) => s.actions).find((a) => a.goto)?.goto;
    const ctx = { narration, page, workDir, preloaded: null, overlays: new Map() };
    if (firstGoto) {
      ctx.preloaded = resolveUrl(narration, firstGoto);
      await page.goto(ctx.preloaded, { waitUntil: 'load' });
    }

    showSpaceWindow(task.name);
    const region = await locateRegion(page, task, ffmpegBin);

    const output = `${workDir}/recording.mp4`;
    capture = startCapture(ffmpegBin, buildGdigrabArgs({ region, ...narration.gdigrab, output }));
    // Approximation: frame 0 is taken a little after spawn; we treat spawn + START_DELAY_MS as t=0.
    const t0 = capture.spawnedAt + START_DELAY_MS;
    await sleep(START_DELAY_MS);
    if (capture.exited) throw new Error(`ffmpeg stopped at start:\n${capture.stderrTail()}`);
    const now = () => (Date.now() - t0) / 1000;

    const marks = [];
    for (const scene of narration.scenes) {
      const sceneStartMs = Date.now();
      marks.push({ id: scene.id, start: round3(now()) });
      ctx.overlays.clear();
      ctx.callouts = 0;
      if (narration.captions && scene.say) await mount(ctx, '__narrate_caption', captionHtml(scene.say));
      if (scene.chapter) {
        const durationMs = scene.chapter.durationMs ?? 2000;
        await page.evaluate(domOverlay, { op: 'mount', id: '__narrate_chapter', html: chapterHtml(scene.chapter), durationMs });
        await sleep(durationMs);
      }
      for (const action of scene.actions) await runAction(action, ctx);

      // S5: wait until narration + gap has elapsed since the scene started.
      const narrationMs = tts[scene.id] ? tts[scene.id].duration * 1000 + narration.gapMs : 0;
      const remaining = narrationMs - (Date.now() - sceneStartMs);
      if (remaining > 0) await sleep(remaining);
      for (const id of ctx.overlays.keys()) await page.evaluate(domOverlay, { op: 'remove', id });
      log(`record: ${scene.id} ${((Date.now() - sceneStartMs) / 1000).toFixed(2)}s`);
    }
    await sleep(500);
    const total = round3(now());
    await capture.stop();
    capture = null;

    writeFileSync(`${workDir}/scenes.json`, JSON.stringify({
      total, video: 'recording.mp4', recorder: 'gdigrab', region, scenes: marks,
    }, null, 2));
    writeFileSync(`${workDir}/evidence.json`, JSON.stringify({
      responses: [], console: [], note: 'not collected with recorder gdigrab',
    }, null, 2));
    log(`recording.mp4 ${total.toFixed(1)}s, region ${region.width}x${region.height}+${region.x}+${region.y}`);
  } finally {
    if (capture) await capture.stop().catch(() => {});
    await task.finish({ keep: [] });
  }
}

const resolveUrl = (narration, url) => (narration.baseUrl ? new URL(url, narration.baseUrl).href : url);

function showSpaceWindow(title) {
  const encoded = Buffer.from(showWindowScript(title), 'utf16le').toString('base64');
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8', windowsHide: true,
  });
  const shown = parseInt(String(r.stdout).trim(), 10);
  log(shown > 0 ? `shown window "${title}"` : `could not find window "${title}" (${String(r.stderr).trim().slice(0, 200)})`);
}

/**
 * Locates the page on screen: paints the viewport with the calibration color, grabs the window area
 * and takes the bounding box. Falls back to waiting for the user while the window is hidden/unpainted.
 */
async function locateRegion(page, task, ffmpegBin) {
  const metrics = await page.evaluate(() => ({
    screenX, screenY, outerWidth, outerHeight, innerWidth, innerHeight, devicePixelRatio,
  }));
  const guess = contentRegion(metrics);
  const area = windowArea(metrics);
  log(`window ${JSON.stringify(metrics)} -> formula region ${JSON.stringify(guess)}`);
  await page.evaluate(domOverlay, { op: 'mount', id: '__narrate_calibrate', html: calibrationHtml() });
  try {
    const deadline = Date.now() + VISIBLE_TIMEOUT_MS;
    let warned = false;
    while (Date.now() < deadline) {
      await sleep(500);
      const found = detectRegion(await grabFrame(ffmpegBin, area), area.width, area.height);
      if (found) {
        const region = { ...found, x: area.x + found.x, y: area.y + found.y };
        log(`calibrated region ${JSON.stringify(region)}${sameRegion(region, guess) ? ' (matches formula)' : ' (differs from formula; using calibrated)'}`);
        return region;
      }
      if (!warned) {
        warned = true;
        log(`the page is not visible on screen. In ego, switch to task space "${task.name}" (id ${task.spaceId}) `
          + `and keep its window unobstructed on the primary monitor; waiting ${VISIBLE_TIMEOUT_MS / 1000}s...`);
        showSpaceWindow(task.name);
      }
    }
    throw new Error(`gdigrab: the page of task space "${task.name}" never became visible on screen `
      + '(ego keeps Agent task-space windows hidden until selected; a covered window also fails)');
  } finally {
    await page.evaluate(domOverlay, { op: 'remove', id: '__narrate_calibrate' });
  }
}

const sameRegion = (a, b) => ['x', 'y', 'width', 'height'].every((k) => Math.abs(a[k] - b[k]) <= 2);

function grabFrame(ffmpegBin, area) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin, buildFrameGrabArgs(area), { windowsHide: true });
    const chunks = [];
    let stderr = '';
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg grab: ${stderr.trim()}`))));
  });
}

function startCapture(ffmpegBin, args) {
  const child = spawn(ffmpegBin, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  const state = { spawnedAt: Date.now(), exited: false };
  child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4000)));
  const closed = new Promise((resolve) => child.on('close', (code) => { state.exited = true; resolve(code); }));
  child.on('error', (e) => { state.exited = true; stderr += e.message; });
  state.stderrTail = () => stderr.trim().split('\n').slice(-5).join('\n');
  state.stop = async () => {
    if (!state.exited) child.stdin.write('q');
    const code = await Promise.race([closed, sleep(20_000).then(() => 'timeout')]);
    if (code === 'timeout') {
      child.kill();
      throw new Error('ffmpeg did not stop after "q"');
    }
    if (code !== 0) throw new Error(`ffmpeg exited ${code}:\n${state.stderrTail()}`);
  };
  return state;
}

/** Mount an overlay and remember it so it can be re-mounted after a navigation. */
export async function mount(ctx, id, html, durationMs) {
  ctx.overlays.set(id, { html, until: durationMs ? Date.now() + durationMs : Infinity });
  await ctx.page.evaluate(domOverlay, { op: 'mount', id, html, durationMs });
}

async function remountAll(ctx) {
  for (const [id, o] of ctx.overlays) {
    const left = o.until - Date.now();
    if (left <= 0) continue;
    await ctx.page.evaluate(domOverlay, { op: 'mount', id, html: o.html, durationMs: Number.isFinite(left) ? left : undefined });
  }
}

const label = (verb, selector) => `${verb} ${selector}`.slice(0, 48);

export async function runAction(action, ctx) {
  const { page, narration } = ctx;
  const [key] = Object.keys(action);
  const v = action[key];
  const pointer = (verb, selector) => (narration.showActions ? { label: label(verb, selector) } : {});
  switch (key) {
    case 'goto': {
      const url = resolveUrl(narration, v);
      // The first goto already ran before the capture started (to measure the window); do not reload.
      if (ctx.preloaded === url) {
        ctx.preloaded = null;
        return;
      }
      ctx.preloaded = null;
      await page.goto(url, { waitUntil: 'load' });
      return remountAll(ctx);
    }
    case 'click':
      return page.click(v, pointer('Click', v));
    case 'hover':
      return page.hover(v, pointer('Hover', v));
    case 'check': {
      // No documented check(): click unless a raw-CSS checkbox is already checked.
      if (isCssSelector(v) && await page.evaluate((s) => !!document.querySelector(s)?.checked, v)) return;
      return page.click(v, pointer('Check', v));
    }
    case 'fill':
      return page.fill(v.selector, v.value);
    case 'select':
      return page.selectOption(v.selector, v.value);
    case 'press':
      return v.selector ? page.press(v.selector, v.key) : page.keyboard.press(v.key);
    case 'scroll': {
      if (v.selector) {
        // No documented scroll-into-view: page.evaluate for raw CSS, hover (auto-scrolls) for ego selectors.
        if (isCssSelector(v.selector)) {
          return page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), v.selector);
        }
        return page.hover(v.selector, pointer('Scroll to', v.selector));
      }
      const { w, h } = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
      await page.mouse.move(Math.round(w / 2), Math.round(h / 2));
      return page.mouse.wheel(0, v.y ?? 400);
    }
    case 'wait':
      return sleep(v);
    case 'waitFor': {
      const selector = typeof v === 'string' ? v : v.selector;
      const state = typeof v === 'string' ? 'visible' : v.state ?? 'visible';
      const timeout = (typeof v === 'object' && v.timeoutMs) || 30_000;
      if (!isCssSelector(selector)) return page.waitForSelector(selector, { state, timeout });
      return page.waitForFunction(({ s, st }) => {
        const el = document.querySelector(s);
        const visible = !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
        if (st === 'attached') return !!el;
        if (st === 'detached') return !el;
        if (st === 'hidden') return !visible;
        return visible;
      }, { s: selector, st: state }, { timeout });
    }
    case 'overlay': {
      ctx.callouts += 1;
      return mount(ctx, `__narrate_callout_${ctx.callouts}`, calloutHtml(v), v.durationMs);
    }
    case 'screenshot':
      return page.screenshot({ path: `${ctx.workDir}/${v}.png` });
    default:
      // call / waitForResponse are rejected by validateNarration for recorder gdigrab.
      throw new Error(`action "${key}" is not supported with recorder gdigrab`);
  }
}
