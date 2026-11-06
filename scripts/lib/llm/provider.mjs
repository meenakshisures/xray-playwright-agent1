/**
 * LLM provider abstraction — the seam that makes the model swappable.
 *
 * Every provider exposes the SAME interface:
 *   provider.name        -> string
 *   provider.model       -> string
 *   provider.complete({ system, prompt, temperature?, maxTokens? }) -> { text, raw }
 *
 * The LLM-driven stages (normalize, generate, analyze) depend only on this
 * interface, so switching between Claude, ChatGPT (OpenAI) and Copilot (GitHub
 * Models) is one env var — no pipeline code changes. And because every output is
 * still held to the deterministic contracts (IR schema, @covers, verify gate),
 * the choice of model never lowers the quality bar.
 *
 * Select with LLM_PROVIDER = claude | openai | copilot | mock  (default: mock).
 */
import { makeClaude } from './claude.mjs';
import { makeOpenAI } from './openai.mjs';
import { makeCopilot } from './copilot.mjs';
import { makeMock } from './mock.mjs';

export const PROVIDERS = {
  claude: makeClaude,
  anthropic: makeClaude,
  openai: makeOpenAI,
  chatgpt: makeOpenAI,
  copilot: makeCopilot,
  github: makeCopilot,
  mock: makeMock,
};

export function getProvider(opts = {}) {
  const name = (opts.provider || process.env.LLM_PROVIDER || 'mock').toLowerCase();
  const make = PROVIDERS[name];
  if (!make) throw new Error(`Unknown LLM_PROVIDER "${name}". Use one of: ${Object.keys(PROVIDERS).join(', ')}.`);
  return make(opts);
}
