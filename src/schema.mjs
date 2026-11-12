// Validation and defaults for narration.json scripts.

export const ACTIONS = [
  'goto', 'click', 'fill', 'press', 'hover', 'select', 'check', 'scroll',
  'wait', 'waitFor', 'waitForResponse', 'overlay', 'call', 'screenshot',
];
export const ENGINES = ['edge', 'deepgram', 'sapi'];
export const RECORDERS = ['playwright', 'gdigrab'];
/** Actions that need Playwright pages, so recorder gdigrab (ego-browser) cannot run them. */
export const GDIGRAB_UNSUPPORTED = ['call', 'waitForResponse'];
export const DEFAULT_VOICES = {
  edge: 'es-CO-SalomeNeural',
  deepgram: 'aura-2-celeste-es',
  sapi: 'Microsoft Helena Desktop',
};

const SLUG = /^[a-z0-9][a-z0-9_-]*$/i;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function validateNarration(input) {
  const errors = [];
  const err = (path, msg) => errors.push(`${path}: ${msg}`);
  if (!isObj(input)) throw new Error('narration: must be a JSON object');

  if (!isStr(input.title)) err('title', 'required string');
  if (input.baseUrl !== undefined && !isStr(input.baseUrl)) err('baseUrl', 'must be a string');

  const viewport = input.viewport ?? { width: 1366, height: 768 };
  if (!isObj(viewport) || !isNum(viewport.width) || !isNum(viewport.height)) {
    err('viewport', 'must be { width, height } numbers');
  }

  const ttsIn = input.tts ?? {};
  if (!isObj(ttsIn)) err('tts', 'must be an object');
  const engine = ttsIn.engine ?? 'edge';
  if (!ENGINES.includes(engine)) err('tts.engine', `must be one of ${ENGINES.join(', ')}`);
  const tts = {
    engine,
    voice: ttsIn.voice ?? DEFAULT_VOICES[engine] ?? DEFAULT_VOICES.edge,
    rate: ttsIn.rate ?? '+0%',
    fallback: ttsIn.fallback ?? true,
  };

  const browserIn = input.browser ?? {};
  if (!isObj(browserIn)) err('browser', 'must be an object');
  const browser = {
    channel: browserIn.channel ?? 'chrome',
    headless: browserIn.headless ?? true,
    locale: browserIn.locale ?? 'es-CO',
    storageState: browserIn.storageState,
  };
  if (browser.storageState !== undefined && !isStr(browser.storageState)) {
    err('browser.storageState', 'must be a path string');
  }

  const recorder = input.recorder ?? 'playwright';
  if (!RECORDERS.includes(recorder)) err('recorder', `must be one of ${RECORDERS.join(', ')}`);
  const gdigrabIn = input.gdigrab ?? {};
  if (!isObj(gdigrabIn)) err('gdigrab', 'must be an object');
  const gdigrab = {
    framerate: gdigrabIn.framerate ?? 25,
    drawMouse: gdigrabIn.drawMouse ?? true,
    tab: gdigrabIn.tab ?? 'new',
  };
  if (!isNum(gdigrab.framerate) || gdigrab.framerate <= 0) err('gdigrab.framerate', 'must be a number > 0');
  if (typeof gdigrab.drawMouse !== 'boolean') err('gdigrab.drawMouse', 'must be a boolean');
  if (gdigrab.tab !== 'new') err('gdigrab.tab', 'must be "new"');

  for (const key of ['captions', 'showActions']) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') err(key, 'must be a boolean');
  }
  const gapMs = input.gapMs ?? 400;
  if (!isNum(gapMs) || gapMs < 0) err('gapMs', 'must be a number >= 0');
  if (input.actionsModule !== undefined && !isStr(input.actionsModule)) err('actionsModule', 'must be a path string');
  if (input.output !== undefined && !isStr(input.output)) err('output', 'must be a path string');

  const scenesIn = input.scenes;
  const scenes = [];
  if (!Array.isArray(scenesIn) || scenesIn.length === 0) {
    err('scenes', 'at least one scene');
  } else {
    const seen = new Set();
    scenesIn.forEach((s, i) => {
      const p = `scenes[${i}]`;
      if (!isObj(s)) return err(p, 'must be an object');
      if (!isStr(s.id) || !SLUG.test(s.id)) err(`${p}.id`, 'required slug');
      else if (seen.has(s.id)) err(`${p}.id`, `duplicate "${s.id}"`);
      else seen.add(s.id);
      if (s.say !== undefined && !isStr(s.say)) err(`${p}.say`, 'must be a non-empty string');
      if (s.chapter !== undefined && (!isObj(s.chapter) || !isStr(s.chapter.title))) {
        err(`${p}.chapter`, 'must be { title, description?, durationMs? }');
      }
      const speedup = s.speedup ?? 1;
      if (!isNum(speedup) || speedup < 1) err(`${p}.speedup`, 'must be a number >= 1');
      const actions = s.actions ?? [];
      if (!Array.isArray(actions)) err(`${p}.actions`, 'must be an array');
      else actions.forEach((a, j) => validateAction(a, `${p}.actions[${j}]`, err, recorder));
      scenes.push({ ...s, actions: Array.isArray(actions) ? actions : [], speedup });
    });
  }

  if (errors.length) throw new Error(`Invalid narration:\n  - ${errors.join('\n  - ')}`);

  return {
    ...input,
    viewport,
    tts,
    browser,
    recorder,
    gdigrab,
    captions: input.captions ?? true,
    showActions: input.showActions ?? true,
    gapMs,
    scenes,
  };
}

function validateAction(a, path, err, recorder) {
  if (!isObj(a)) return err(path, 'must be an object with one action key');
  const keys = Object.keys(a);
  if (keys.length !== 1) return err(path, `exactly one action key, got ${keys.join(', ') || 'none'}`);
  const [key] = keys;
  if (!ACTIONS.includes(key)) return err(path, `unknown action "${key}"`);
  if (recorder === 'gdigrab' && GDIGRAB_UNSUPPORTED.includes(key)) {
    return err(path, `"${key}" is not supported with recorder gdigrab`);
  }
  const v = a[key];
  switch (key) {
    case 'wait':
      if (!isNum(v) || v < 0) err(path, 'wait: milliseconds >= 0');
      break;
    case 'fill':
    case 'select':
      if (!isObj(v) || !isStr(v.selector) || typeof v.value !== 'string') err(path, `${key}: { selector, value }`);
      break;
    case 'press':
      if (!isObj(v) || !isStr(v.key)) err(path, 'press: { key, selector? }');
      break;
    case 'overlay':
      if (!isObj(v) || (!isStr(v.html) && !isStr(v.text))) err(path, 'overlay: { text | html, kind?, title?, durationMs? }');
      break;
    case 'scroll':
      if (!isObj(v)) err(path, 'scroll: { selector? , y? }');
      break;
    case 'waitFor':
      if (!isStr(v) && !(isObj(v) && isStr(v.selector))) err(path, 'waitFor: selector or { selector, state }');
      break;
    default:
      if (!isStr(v)) err(path, `${key}: must be a non-empty string`);
  }
}
