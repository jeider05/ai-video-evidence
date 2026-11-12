import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFrameGrabArgs,
  buildGdigrabArgs,
  contentRegion,
  detectRegion,
  isCssSelector,
  windowArea,
} from '../src/gdigrab.mjs';
import { calloutHtml, captionHtml, chapterHtml, domOverlay } from '../src/overlays.mjs';

// Measured on ego lite 0.6.2.7, maximized on a 1920x1200 monitor at 125 % (vertical tab strip on the left).
const EGO_125 = {
  screenX: 0,
  screenY: 0,
  outerWidth: 1536,
  outerHeight: 912,
  innerWidth: 1284,
  innerHeight: 859,
  devicePixelRatio: 1.25,
};

test('contentRegion maps the measured ego window at 125 % to physical pixels', () => {
  // Content seen in a desktop grab: x 308..1913, y 59..1133 (ego draws a 7 px frame right/bottom).
  assert.deepEqual(contentRegion(EGO_125), { x: 308, y: 59, width: 1604, height: 1072 });
});

test('contentRegion rounds width/height down to even numbers and honours window position and frame', () => {
  const r = contentRegion({
    screenX: 100,
    screenY: 50,
    outerWidth: 1001,
    outerHeight: 801,
    innerWidth: 985,
    innerHeight: 700,
    devicePixelRatio: 1,
    frame: 8,
  });
  assert.deepEqual(r, { x: 108, y: 143, width: 984, height: 700 });
  assert.equal(r.width % 2, 0);
  assert.equal(r.height % 2, 0);
});

test('windowArea is the visible window in physical pixels', () => {
  assert.deepEqual(windowArea(EGO_125), { x: 0, y: 0, width: 1920, height: 1140 });
});

test('buildGdigrabArgs captures a desktop region with libx264', () => {
  assert.deepEqual(
    buildGdigrabArgs({ region: { x: 308, y: 59, width: 1604, height: 1072 }, framerate: 25, drawMouse: true, output: 'out/recording.mp4' }),
    [
      '-y', '-f', 'gdigrab', '-framerate', '25', '-draw_mouse', '1',
      '-offset_x', '308', '-offset_y', '59', '-video_size', '1604x1072', '-i', 'desktop',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p', 'out/recording.mp4',
    ],
  );
  const noMouse = buildGdigrabArgs({ region: { x: 0, y: 0, width: 640, height: 480 }, framerate: 30, drawMouse: false, output: 'o.mp4' });
  assert.equal(noMouse[noMouse.indexOf('-draw_mouse') + 1], '0');
  assert.equal(noMouse[noMouse.indexOf('-framerate') + 1], '30');
});

test('buildFrameGrabArgs grabs one raw RGB frame of an area to stdout', () => {
  assert.deepEqual(buildFrameGrabArgs({ x: 0, y: 0, width: 1920, height: 1140 }), [
    '-loglevel', 'error', '-f', 'gdigrab', '-offset_x', '0', '-offset_y', '0', '-video_size', '1920x1140',
    '-i', 'desktop', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
  ]);
});

function frame(width, height, box) {
  const buf = Buffer.alloc(width * height * 3, 0x20);
  for (let y = box.y; y < box.y + box.height; y++) {
    for (let x = box.x; x < box.x + box.width; x++) {
      const i = (y * width + x) * 3;
      buf[i] = 255;
      buf[i + 1] = 0;
      buf[i + 2] = 255;
    }
  }
  return buf;
}

test('detectRegion finds the magenta calibration box (even size) inside an area', () => {
  const buf = frame(200, 120, { x: 31, y: 9, width: 151, height: 103 });
  assert.deepEqual(detectRegion(buf, 200, 120), { x: 31, y: 9, width: 150, height: 102 });
});

test('detectRegion returns null when the calibration color is not on screen', () => {
  assert.equal(detectRegion(Buffer.alloc(100 * 50 * 3, 0x20), 100, 50), null);
});

test('isCssSelector tells raw CSS apart from ego selector syntaxes', () => {
  for (const s of ['#save', 'button.primary', 'input[name=q]']) assert.equal(isCssSelector(s), true, s);
  for (const s of ['@21', 'ref=21', 'text=Guardar', "loc=role:button[name='Guardar']", 'xpath=//a', 'css=#a', 'a:has-text("x")', '#a >> nth=1']) {
    assert.equal(isCssSelector(s), false, s);
  }
});

test('overlays keep the record.mjs caption/callout markup and add a chapter card', () => {
  assert.match(captionHtml('a < b'), /a &lt; b/);
  assert.match(calloutHtml({ kind: 'actual', text: 'x' }), /Actual/);
  const chapter = chapterHtml({ title: 'Impacto', description: 'El <operador>' });
  assert.match(chapter, /backdrop-filter:blur/);
  assert.match(chapter, /Impacto/);
  assert.match(chapter, /El &lt;operador&gt;/);
});

test('domOverlay mounts a click-through top-most host and removes it', () => {
  const nodes = new Map();
  const body = { appendChild: (el) => nodes.set(el.id, el) };
  const document = {
    body,
    documentElement: body,
    getElementById: (id) => nodes.get(id) ?? null,
    createElement: () => {
      const el = { style: {}, remove: () => nodes.delete(el.id) };
      return el;
    },
  };
  globalThis.document = document;
  try {
    domOverlay({ op: 'mount', id: '__narrate_caption', html: '<b>hola</b>' });
    const el = nodes.get('__narrate_caption');
    assert.equal(el.innerHTML, '<b>hola</b>');
    assert.match(el.style.cssText, /pointer-events:none/);
    assert.match(el.style.cssText, /z-index:2147483647/);
    domOverlay({ op: 'mount', id: '__narrate_caption', html: '<b>otra</b>' });
    assert.equal(nodes.size, 1);
    domOverlay({ op: 'remove', id: '__narrate_caption' });
    assert.equal(nodes.size, 0);
  } finally {
    delete globalThis.document;
  }
});
