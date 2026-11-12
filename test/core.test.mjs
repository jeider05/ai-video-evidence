import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateNarration } from '../src/schema.mjs';
import { buildTimeline } from '../src/timeline.mjs';
import { toSrt, splitCue } from '../src/srt.mjs';
import { buildAssembleArgs } from '../src/ffmpeg.mjs';

const minimal = { title: 'Demo', scenes: [{ id: 'intro', say: 'Hola' }] };

test('validateNarration applies defaults to a minimal script', () => {
  const n = validateNarration(minimal);
  assert.equal(n.title, 'Demo');
  assert.deepEqual(n.viewport, { width: 1366, height: 768 });
  assert.equal(n.tts.engine, 'edge');
  assert.equal(n.tts.voice, 'es-CO-SalomeNeural');
  assert.equal(n.tts.fallback, true);
  assert.equal(n.captions, true);
  assert.equal(n.showActions, true);
  assert.equal(n.gapMs, 400);
  assert.deepEqual(n.scenes[0].actions, []);
  assert.equal(n.scenes[0].speedup, 1);
});

test('validateNarration reports every problem with its path', () => {
  assert.throws(
    () => validateNarration({
      scenes: [
        { id: 'a', actions: [{ clik: '#x' }] },
        { id: 'a', speedup: 0.5 },
        { say: 'sin id' },
      ],
      tts: { engine: 'polly' },
    }),
    (err) => {
      assert.match(err.message, /title: required string/);
      assert.match(err.message, /scenes\[0\]\.actions\[0\]: unknown action "clik"/);
      assert.match(err.message, /scenes\[1\]\.id: duplicate "a"/);
      assert.match(err.message, /scenes\[1\]\.speedup: must be a number >= 1/);
      assert.match(err.message, /scenes\[2\]\.id: required slug/);
      assert.match(err.message, /tts\.engine: must be one of edge, deepgram, sapi/);
      return true;
    },
  );
});

test('validateNarration rejects an empty scene list and multi-key actions', () => {
  assert.throws(() => validateNarration({ title: 't', scenes: [] }), /scenes: at least one scene/);
  assert.throws(
    () => validateNarration({ title: 't', scenes: [{ id: 'a', actions: [{ click: '#a', wait: 10 }] }] }),
    /scenes\[0\]\.actions\[0\]: exactly one action key, got click, wait/,
  );
});

test('buildTimeline keeps normal speed and places audio at each scene start', () => {
  const t = buildTimeline({
    total: 10,
    scenes: [
      { id: 'a', start: 0.5, audio: { file: 'a.mp3', duration: 3 }, say: 'Uno.' },
      { id: 'b', start: 5, audio: { file: 'b.mp3', duration: 2 }, say: 'Dos.' },
    ],
  });
  assert.deepEqual(t.segments, [
    { from: 0, to: 0.5, speed: 1 },
    { from: 0.5, to: 5, speed: 1 },
    { from: 5, to: 10, speed: 1 },
  ]);
  assert.deepEqual(t.audios, [
    { file: 'a.mp3', at: 0.5 },
    { file: 'b.mp3', at: 5 },
  ]);
  assert.equal(t.duration, 10);
  assert.deepEqual(t.cues, [
    { start: 0.5, end: 3.5, text: 'Uno.' },
    { start: 5, end: 7, text: 'Dos.' },
  ]);
});

test('buildTimeline speeds up only the part of a scene after its narration', () => {
  const t = buildTimeline({
    total: 30,
    scenes: [
      { id: 'a', start: 0, audio: { file: 'a.mp3', duration: 2 }, say: 'Esperando', speedup: 4 },
      { id: 'b', start: 22, audio: { file: 'b.mp3', duration: 3 }, say: 'Listo' },
    ],
  });
  assert.deepEqual(t.segments, [
    { from: 0, to: 2, speed: 1 },
    { from: 2, to: 22, speed: 4 },
    { from: 22, to: 30, speed: 1 },
  ]);
  // 2s normal + 20s at x4 = 7s before scene b.
  assert.deepEqual(t.audios, [
    { file: 'a.mp3', at: 0 },
    { file: 'b.mp3', at: 7 },
  ]);
  assert.equal(t.duration, 15);
});

test('buildTimeline handles scenes without narration', () => {
  const t = buildTimeline({
    total: 8,
    scenes: [
      { id: 'a', start: 0, speedup: 2 },
      { id: 'b', start: 4, audio: { file: 'b.mp3', duration: 1 }, say: 'Fin' },
    ],
  });
  assert.deepEqual(t.segments, [
    { from: 0, to: 4, speed: 2 },
    { from: 4, to: 8, speed: 1 },
  ]);
  assert.deepEqual(t.audios, [{ file: 'b.mp3', at: 2 }]);
  assert.deepEqual(t.cues, [{ start: 2, end: 3, text: 'Fin' }]);
});

test('splitCue splits long narration by sentences with proportional timing', () => {
  const cues = splitCue('Primera frase corta. Segunda frase que es bastante más larga que la otra.', 10, 6, 60);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, 'Primera frase corta.');
  assert.equal(cues[1].text, 'Segunda frase que es bastante más larga que la otra.');
  assert.equal(cues[0].start, 10);
  assert.equal(cues[1].end, 16);
  assert.ok(cues[0].end > 10 && cues[0].end < 13);
  assert.equal(cues[0].end, cues[1].start);
});

test('splitCue keeps short narration as one cue', () => {
  assert.deepEqual(splitCue('Hola mundo.', 1, 2, 84), [{ start: 1, end: 3, text: 'Hola mundo.' }]);
});

test('toSrt formats numbered cues with comma milliseconds', () => {
  assert.equal(
    toSrt([{ start: 0.5, end: 3.25, text: 'Uno' }, { start: 3661.001, end: 3662, text: 'Dos' }]),
    '1\n00:00:00,500 --> 00:00:03,250\nUno\n\n2\n01:01:01,001 --> 01:01:02,000\nDos\n',
  );
});

test('buildAssembleArgs builds trim/setpts/concat and adelay/amix graphs', () => {
  const args = buildAssembleArgs({
    video: 'rec.webm',
    segments: [
      { from: 0, to: 2, speed: 1 },
      { from: 2, to: 22, speed: 4 },
    ],
    audios: [
      { file: 'a.mp3', at: 0 },
      { file: 'b.mp3', at: 7.25 },
    ],
    srt: 'out.srt',
    output: 'out.mp4',
  });
  assert.deepEqual(args.slice(0, 10), ['-y', '-i', 'rec.webm', '-i', 'a.mp3', '-i', 'b.mp3', '-i', 'out.srt', '-filter_complex']);
  const graph = args[10];
  assert.equal(
    graph,
    '[0:v]trim=start=0:end=2,setpts=PTS-STARTPTS[v0];' +
      '[0:v]trim=start=2:end=22,setpts=(PTS-STARTPTS)/4[v1];' +
      '[v0][v1]concat=n=2:v=1:a=0[vout];' +
      '[1:a]adelay=0:all=1[a0];[2:a]adelay=7250:all=1[a1];' +
      '[a0][a1]amix=inputs=2:duration=longest:normalize=0[aout]',
  );
  const rest = args.slice(11).join(' ');
  assert.match(rest, /-map \[vout\] -map \[aout\] -map 3:s/);
  assert.match(rest, /-c:v libx264 .*-pix_fmt yuv420p/);
  assert.match(rest, /-c:a aac/);
  assert.match(rest, /-c:s mov_text/);
  assert.equal(args.at(-1), 'out.mp4');
});

test('buildAssembleArgs without audio maps only video', () => {
  const args = buildAssembleArgs({ video: 'v.webm', segments: [{ from: 0, to: 3, speed: 1 }], audios: [], output: 'o.mp4' });
  const s = args.join(' ');
  assert.doesNotMatch(s, /amix|-c:a|aout/);
  assert.match(s, /-map \[vout\]/);
});
