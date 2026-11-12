#!/usr/bin/env node
// narrate: narrated video evidence (voice + screen) for features and bugs.

import { assemble, load, record, tts } from '../src/pipeline.mjs';

const USAGE = `Usage: narrate <command> <narration.json> [--out <dir>]

Commands:
  validate   Check the script and print its scenes
  tts        Synthesize each scene's "say" (edge-tts -> Deepgram -> SAPI) into tts.json
  record     Record the scenes with Playwright; writes recording.webm, scenes.json, evidence.json
  assemble   Mix narration, speed-ups and captions into <name>.mp4 + <name>.srt
  run        tts + record + assemble

Environment:
  DEEPGRAM_API_KEY / DEEPGRAM_API_KEY_FILE   enable the Deepgram fallback
  NARRATE_PYTHON                             Python with edge-tts (default: python)`;

const log = (msg) => console.log(msg);

async function main(argv) {
  const [command, file, ...rest] = argv;
  if (!command || command === '-h' || command === '--help') {
    console.log(USAGE);
    return 0;
  }
  const commands = ['validate', 'tts', 'record', 'assemble', 'run'];
  if (!commands.includes(command) || !file) {
    console.error(USAGE);
    return 2;
  }
  const outIndex = rest.indexOf('--out');
  const out = outIndex >= 0 ? rest[outIndex + 1] : undefined;
  if (outIndex >= 0 && !out) {
    console.error('--out needs a directory');
    return 2;
  }

  const job = load(file, { out });
  if (command === 'validate') {
    log(`ok: "${job.narration.title}", ${job.narration.scenes.length} scenes -> ${job.output}`);
    for (const s of job.narration.scenes) log(`  - ${s.id}: ${s.actions.length} actions${s.say ? '' : ' (no narration)'}`);
    return 0;
  }
  if (command === 'tts' || command === 'run') await tts(job, log);
  if (command === 'record' || command === 'run') await record(job, log);
  if (command === 'assemble' || command === 'run') await assemble(job, log);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(`narrate: ${e.message}`);
    process.exit(1);
  },
);
