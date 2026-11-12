// SubRip captions generated from the narration script.

const round = (n) => Math.round(n * 1000) / 1000;

/** Split one narration into sentence-sized cues, timed proportionally to their length. */
export function splitCue(text, start, duration, maxChars = 84) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return [{ start: round(start), end: round(start + duration), text: clean }];

  const sentences = clean.match(/[^.!?;]+[.!?;]*/g).map((s) => s.trim()).filter(Boolean);
  const chunks = [];
  for (const sentence of sentences) {
    if (sentence.length <= maxChars) {
      chunks.push(sentence);
      continue;
    }
    // Long sentence: break on commas, then on words.
    let current = '';
    for (const word of sentence.split(' ')) {
      if (current && (current + ' ' + word).length > maxChars) {
        chunks.push(current);
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
    if (current) chunks.push(current);
  }

  const totalChars = chunks.reduce((n, c) => n + c.length, 0);
  const cues = [];
  let t = start;
  chunks.forEach((chunk, i) => {
    const end = i === chunks.length - 1 ? start + duration : t + (duration * chunk.length) / totalChars;
    cues.push({ start: round(t), end: round(end), text: chunk });
    t = end;
  });
  return cues;
}

function stamp(seconds) {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

export function toSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join('\n');
}
