// Records the scenes with Playwright's page.screencast (>= 1.59).
// Each scene waits max(actions, narration + gap) so the voice never runs ahead of the video.

import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const KIND_STYLE = {
  actual: { color: '#b42318', label: 'Actual' },
  expected: { color: '#067647', label: 'Esperado' },
  info: { color: '#175cd3', label: 'Nota' },
};

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function captionHtml(text) {
  return `<div style="position:fixed;left:50%;bottom:28px;transform:translateX(-50%);max-width:80%;` +
    `padding:10px 18px;border-radius:8px;background:rgba(16,24,40,.82);color:#fff;` +
    `font:500 20px/1.35 system-ui,Segoe UI,sans-serif;text-align:center;">${escapeHtml(text)}</div>`;
}

export function calloutHtml({ kind = 'info', title, text, html }) {
  const k = KIND_STYLE[kind] ?? KIND_STYLE.info;
  const body = html ?? `<div>${escapeHtml(text)}</div>`;
  return `<div style="position:fixed;top:24px;left:24px;max-width:46%;padding:14px 18px;border-radius:10px;` +
    `background:#fff;border:3px solid ${k.color};box-shadow:0 8px 24px rgba(0,0,0,.25);` +
    `font:500 18px/1.4 system-ui,Segoe UI,sans-serif;color:#101828;">` +
    `<div style="font-weight:700;color:${k.color};margin-bottom:6px;">${escapeHtml(title ?? k.label)}</div>${body}</div>`;
}

export async function recordScenes(narration, { baseDir, workDir, tts, log = () => {} }) {
  const actionsModule = narration.actionsModule
    ? await import(pathToFileURL(resolve(baseDir, narration.actionsModule)).href)
    : {};
  const browser = await chromium.launch({ channel: narration.browser.channel, headless: narration.browser.headless });
  const context = await browser.newContext({
    viewport: narration.viewport,
    locale: narration.browser.locale,
    deviceScaleFactor: 1,
    storageState: narration.browser.storageState ? resolve(baseDir, narration.browser.storageState) : undefined,
  });
  const page = await context.newPage();

  // Evidence collected while recording: failed responses and console errors.
  const evidence = { responses: [], console: [] };
  const responses = [];
  page.on('response', (r) => {
    const entry = { at: Date.now(), url: r.url(), status: r.status(), method: r.request().method() };
    responses.push(entry);
    if (entry.status >= 400) evidence.responses.push(entry);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') evidence.console.push({ at: Date.now(), text: m.text() });
  });
  page.on('pageerror', (e) => evidence.console.push({ at: Date.now(), text: `pageerror: ${e.message}` }));

  const videoPath = join(workDir, 'recording.webm');
  await page.screencast.start({ path: videoPath, size: narration.viewport, quality: 90 });
  const t0 = Date.now();
  const now = () => (Date.now() - t0) / 1000;
  if (narration.showActions) await page.screencast.showActions({ position: 'top-right' });

  const marks = [];
  try {
    for (const scene of narration.scenes) {
      const sceneStartMs = Date.now();
      marks.push({ id: scene.id, start: now() });
      const disposables = [];
      if (narration.captions && scene.say) disposables.push(await page.screencast.showOverlay(captionHtml(scene.say)));
      if (scene.chapter) {
        await page.screencast.showChapter(scene.chapter.title, {
          description: scene.chapter.description,
          duration: scene.chapter.durationMs ?? 2000,
        });
      }

      for (const action of scene.actions) {
        await runAction(page, action, { narration, scene, workDir, actionsModule, responses, sceneStartMs, disposables });
      }

      const narrationMs = tts[scene.id] ? tts[scene.id].duration * 1000 + narration.gapMs : 0;
      const remaining = narrationMs - (Date.now() - sceneStartMs);
      if (remaining > 0) await page.waitForTimeout(remaining);
      for (const d of disposables) await d?.dispose?.();
      log(`record: ${scene.id} ${((Date.now() - sceneStartMs) / 1000).toFixed(2)}s`);
    }
    await page.waitForTimeout(500);
  } finally {
    const total = now();
    await page.screencast.stop();
    await context.close();
    await browser.close();
    const rel = (e) => ({ ...e, at: Math.round(((e.at - t0) / 1000) * 1000) / 1000 });
    writeFileSync(join(workDir, 'scenes.json'), JSON.stringify({ total, scenes: marks }, null, 2));
    writeFileSync(join(workDir, 'evidence.json'), JSON.stringify({
      responses: evidence.responses.map(rel),
      console: evidence.console.map(rel),
    }, null, 2));
  }
  return { videoPath, marks };
}

async function runAction(page, action, ctx) {
  const [key] = Object.keys(action);
  const v = action[key];
  switch (key) {
    case 'goto':
      return page.goto(ctx.narration.baseUrl ? new URL(v, ctx.narration.baseUrl).href : v, { waitUntil: 'load' });
    case 'click':
      return page.locator(v).click();
    case 'hover':
      return page.locator(v).hover();
    case 'check':
      return page.locator(v).check();
    case 'fill':
      return page.locator(v.selector).fill(v.value);
    case 'select':
      return page.locator(v.selector).selectOption(v.value);
    case 'press':
      return v.selector ? page.locator(v.selector).press(v.key) : page.keyboard.press(v.key);
    case 'scroll':
      if (v.selector) return page.locator(v.selector).scrollIntoViewIfNeeded();
      return page.mouse.wheel(0, v.y ?? 400);
    case 'wait':
      return page.waitForTimeout(v);
    case 'waitFor':
      return typeof v === 'string'
        ? page.locator(v).waitFor()
        : page.locator(v.selector).waitFor({ state: v.state ?? 'visible', timeout: v.timeoutMs });
    case 'waitForResponse': {
      // Accept a response already seen in this scene (the click that triggered it ran before).
      if (ctx.responses.some((r) => r.at >= ctx.sceneStartMs && r.url.includes(v))) return;
      return page.waitForResponse((r) => r.url().includes(v));
    }
    case 'overlay': {
      const d = await page.screencast.showOverlay(calloutHtml(v), v.durationMs ? { duration: v.durationMs } : undefined);
      if (!v.durationMs) ctx.disposables.push(d);
      return;
    }
    case 'screenshot':
      return page.screenshot({ path: join(ctx.workDir, `${v}.png`) });
    case 'call': {
      const fn = ctx.actionsModule[v];
      if (typeof fn !== 'function') throw new Error(`call: "${v}" is not exported by actionsModule`);
      return fn(page, { narration: ctx.narration, scene: ctx.scene });
    }
    default:
      throw new Error(`unknown action ${key}`);
  }
}
