import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineOrder, cacheKey, voiceFor } from '../src/tts.mjs';

test('engineOrder tries the chosen engine first and then the fallback chain', () => {
  assert.deepEqual(engineOrder('edge', true, { DEEPGRAM_API_KEY: 'k' }), ['edge', 'deepgram', 'sapi']);
  assert.deepEqual(engineOrder('deepgram', true, { DEEPGRAM_API_KEY: 'k' }), ['deepgram', 'edge', 'sapi']);
});

test('engineOrder skips Deepgram without a key and honors fallback=false', () => {
  assert.deepEqual(engineOrder('edge', true, {}), ['edge', 'sapi']);
  assert.deepEqual(engineOrder('edge', false, {}), ['edge']);
  assert.deepEqual(engineOrder('deepgram', false, { DEEPGRAM_API_KEY_FILE: 'C:/k.txt' }), ['deepgram']);
});

test('voiceFor keeps the configured voice only for the configured engine', () => {
  const tts = { engine: 'edge', voice: 'es-CO-GonzaloNeural' };
  assert.equal(voiceFor(tts, 'edge'), 'es-CO-GonzaloNeural');
  assert.equal(voiceFor(tts, 'deepgram'), 'aura-2-celeste-es');
  assert.equal(voiceFor(tts, 'sapi'), 'Microsoft Helena Desktop');
});

test('cacheKey changes with text, voice, engine and rate', () => {
  const base = cacheKey({ engine: 'edge', voice: 'v', rate: '+0%', text: 'hola' });
  assert.match(base, /^[0-9a-f]{16}$/);
  assert.equal(base, cacheKey({ engine: 'edge', voice: 'v', rate: '+0%', text: 'hola' }));
  assert.notEqual(base, cacheKey({ engine: 'edge', voice: 'v', rate: '+0%', text: 'chau' }));
  assert.notEqual(base, cacheKey({ engine: 'edge', voice: 'w', rate: '+0%', text: 'hola' }));
  assert.notEqual(base, cacheKey({ engine: 'sapi', voice: 'v', rate: '+0%', text: 'hola' }));
  assert.notEqual(base, cacheKey({ engine: 'edge', voice: 'v', rate: '+10%', text: 'hola' }));
});
