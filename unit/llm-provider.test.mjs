import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getProvider, PROVIDERS } from '../scripts/lib/llm/provider.mjs';

test('factory resolves each provider name', () => {
  assert.equal(getProvider({ provider: 'claude' }).name, 'claude');
  assert.equal(getProvider({ provider: 'openai' }).name, 'openai');
  assert.equal(getProvider({ provider: 'copilot' }).name, 'copilot');
  assert.equal(getProvider({ provider: 'mock' }).name, 'mock');
});

test('aliases map to the same providers', () => {
  assert.equal(getProvider({ provider: 'anthropic' }).name, 'claude');
  assert.equal(getProvider({ provider: 'chatgpt' }).name, 'openai');
  assert.ok('github' in PROVIDERS);
});

test('unknown provider throws a helpful error', () => {
  assert.throws(() => getProvider({ provider: 'nope' }), /Unknown LLM_PROVIDER/);
});

test('every provider exposes the same interface', () => {
  for (const name of ['claude', 'openai', 'copilot', 'mock']) {
    const p = getProvider({ provider: name });
    assert.equal(typeof p.complete, 'function');
    assert.equal(typeof p.name, 'string');
    assert.equal(typeof p.model, 'string');
  }
});

test('mock.complete returns the scripted response', async () => {
  const m = getProvider({ provider: 'mock', responder: () => 'hello' });
  assert.equal((await m.complete({ prompt: 'x' })).text, 'hello');
});

test('API providers reject without a key (no network)', async () => {
  const c = getProvider({ provider: 'claude', apiKey: undefined });
  if (!process.env.ANTHROPIC_API_KEY) await assert.rejects(c.complete({ prompt: 'x' }), /ANTHROPIC_API_KEY/);
});
