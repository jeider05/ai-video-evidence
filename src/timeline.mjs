// Maps recorded scene marks to output segments, audio placements and caption cues.
//
// Each scene runs from its recorded `start` to the next scene's start (or the end of
// the recording). Its narration plays at normal speed from the scene start; when the
// scene has `speedup > 1`, only the part after the narration is accelerated, so the
// voice never plays over fast-forwarded video.

import { splitCue } from './srt.mjs';

const round = (n) => Math.round(n * 1000) / 1000;

export function buildTimeline({ total, scenes, maxCueChars = 84 }) {
  const segments = [];
  const audios = [];
  const cues = [];
  let out = 0;

  const push = (from, to, speed) => {
    if (to - from <= 0.0005) return;
    segments.push({ from: round(from), to: round(to), speed });
    out += (to - from) / speed;
  };

  if (scenes.length && scenes[0].start > 0) push(0, scenes[0].start, 1);

  scenes.forEach((scene, i) => {
    const end = i + 1 < scenes.length ? scenes[i + 1].start : total;
    const at = round(out);
    const audioDur = scene.audio?.duration ?? 0;
    if (scene.audio) audios.push({ file: scene.audio.file, at });
    if (scene.say && audioDur > 0) cues.push(...splitCue(scene.say, at, audioDur, maxCueChars));

    const speed = scene.speedup ?? 1;
    if (speed > 1) {
      const split = Math.min(end, scene.start + audioDur);
      push(scene.start, split, 1);
      push(split, end, speed);
    } else {
      push(scene.start, end, 1);
    }
  });

  return { segments, audios, cues, duration: round(out) };
}
