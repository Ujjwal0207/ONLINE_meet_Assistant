import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const optionsModule = path.resolve(
  __dirname,
  '../../../../dist-electron/electron/audio/whisper/whisperGenerationOptions.js',
);
const { buildWhisperGenerationOptions } = await import(pathToFileURL(optionsModule).href);

test('English-only checkpoints omit task and language for streaming and final passes', () => {
  for (const streaming of [true, false]) {
    const options = buildWhisperGenerationOptions(streaming, true, 'english');
    assert.equal('task' in options, false);
    assert.equal('language' in options, false);
    assert.equal(options.sampling_rate, 16000);
  }
});

test('multilingual checkpoints retain explicit transcription task and chosen language', () => {
  const options = buildWhisperGenerationOptions(false, false, 'french');
  assert.equal(options.task, 'transcribe');
  assert.equal(options.language, 'french');
});

test('multilingual auto language lets Transformers apply its default', () => {
  const options = buildWhisperGenerationOptions(true, false, null);
  assert.equal(options.task, 'transcribe');
  assert.equal('language' in options, false);
  assert.equal(options.temperature, 0);
});
