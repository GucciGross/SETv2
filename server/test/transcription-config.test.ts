import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transcriptionConfig } from '../src/transcription-config.js';

test('a chat-only endpoint cannot advertise or receive transcription', () => {
  const env = { LLM_BASE_URL: 'http://ollama:11434/v1', LLM_API_KEY: 'chat-only', TRANSCRIBE_BASE_URL: '' };
  assert.deepEqual(transcriptionConfig(env), { baseUrl: undefined, apiKey: undefined, model: 'whisper-1' });
});

test('an explicit local speech endpoint never inherits the chat credential', () => {
  const env = { TRANSCRIBE_BASE_URL: ' http://whisper:8080/v1 ', TRANSCRIBE_API_KEY: '', LLM_API_KEY: 'different-provider' };
  assert.deepEqual(transcriptionConfig(env), { baseUrl: 'http://whisper:8080/v1', apiKey: undefined, model: 'whisper-1' });
});

test('explicit speech endpoint, credential and model remain supported', () => {
  assert.deepEqual(transcriptionConfig({ TRANSCRIBE_BASE_URL: 'https://speech.example/v1', TRANSCRIBE_API_KEY: 'speech-only', TRANSCRIBE_MODEL: 'my-transcriber' }), {
    baseUrl: 'https://speech.example/v1', apiKey: 'speech-only', model: 'my-transcriber',
  });
});

test('whitespace-only configuration is disabled and empty models use the default', () => {
  assert.deepEqual(transcriptionConfig({ TRANSCRIBE_BASE_URL: '  ', TRANSCRIBE_API_KEY: '  ', TRANSCRIBE_MODEL: '' }), {
    baseUrl: undefined, apiKey: undefined, model: 'whisper-1',
  });
});
