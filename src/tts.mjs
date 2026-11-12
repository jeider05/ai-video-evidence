// Text-to-speech per scene: edge-tts by default, Deepgram and Windows SAPI as fallbacks.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_VOICES, ENGINES } from './schema.mjs';
import { probeDuration, run } from './ffmpeg.mjs';

const EXT = { edge: 'mp3', deepgram: 'mp3', sapi: 'wav' };

export function engineOrder(engine, fallback, env = process.env) {
  const hasDeepgram = Boolean(env.DEEPGRAM_API_KEY || env.DEEPGRAM_API_KEY_FILE);
  const chain = fallback ? [engine, ...ENGINES.filter((e) => e !== engine)] : [engine];
  return chain.filter((e) => e !== 'deepgram' || hasDeepgram);
}

export function voiceFor(tts, engine) {
  return engine === tts.engine ? tts.voice : DEFAULT_VOICES[engine];
}

export function cacheKey({ engine, voice, rate, text }) {
  return createHash('sha256').update([engine, voice, rate, text].join('\u0000')).digest('hex').slice(0, 16);
}

function deepgramKey(env = process.env) {
  if (env.DEEPGRAM_API_KEY) return env.DEEPGRAM_API_KEY.trim();
  if (env.DEEPGRAM_API_KEY_FILE) return readFileSync(env.DEEPGRAM_API_KEY_FILE, 'utf8').trim();
  throw new Error('deepgram: set DEEPGRAM_API_KEY or DEEPGRAM_API_KEY_FILE');
}

const engines = {
  async edge({ text, voice, rate, file }) {
    const python = process.env.NARRATE_PYTHON || 'python';
    await run(python, ['-m', 'edge_tts', '--voice', voice, `--rate=${rate}`, '--text', text, '--write-media', file]);
  },
  async deepgram({ text, voice, file }) {
    const res = await fetch(`https://api.deepgram.com/v1/speak?model=${encodeURIComponent(voice)}&encoding=mp3`, {
      method: 'POST',
      headers: { Authorization: `Token ${deepgramKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`deepgram: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  },
  async sapi({ text, voice, file }) {
    const ps = [
      '[Console]::InputEncoding = [Text.Encoding]::UTF8',
      'Add-Type -AssemblyName System.Speech',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      `try { $s.SelectVoice('${voice.replace(/'/g, "''")}') } catch {}`,
      `$s.SetOutputToWaveFile('${file.replace(/'/g, "''")}')`,
      '$s.Speak([Console]::In.ReadToEnd())',
      '$s.Dispose()',
    ].join('; ');
    await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { input: text });
  },
};

/** Synthesize one text, trying each engine in order. Results are cached by content. */
export async function synthesize({ text, tts, cacheDir, log = () => {} }) {
  mkdirSync(cacheDir, { recursive: true });
  const failures = [];
  for (const engine of engineOrder(tts.engine, tts.fallback)) {
    const voice = voiceFor(tts, engine);
    const file = join(cacheDir, `${cacheKey({ engine, voice, rate: tts.rate, text })}.${EXT[engine]}`);
    try {
      if (!existsSync(file)) await engines[engine]({ text, voice, rate: tts.rate, file });
      const duration = await probeDuration(file);
      if (failures.length) log(`tts: fell back to ${engine} (${failures.join('; ')})`);
      return { file, duration, engine, voice };
    } catch (e) {
      failures.push(`${engine}: ${e.message.split('\n')[0]}`);
    }
  }
  throw new Error(`tts: every engine failed\n  ${failures.join('\n  ')}`);
}

/** Synthesize every scene with narration; returns { [sceneId]: { file, duration, engine, voice } }. */
export async function synthesizeScenes(narration, { cacheDir, log = () => {} }) {
  const manifest = {};
  for (const scene of narration.scenes) {
    if (!scene.say) continue;
    manifest[scene.id] = await synthesize({ text: scene.say, tts: narration.tts, cacheDir, log });
    log(`tts: ${scene.id} ${manifest[scene.id].duration.toFixed(2)}s (${manifest[scene.id].engine})`);
  }
  return manifest;
}
