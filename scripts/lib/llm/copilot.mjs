/**
 * GitHub Copilot provider.
 *
 * Copilot's editor assistant has no plain REST completion API; the programmatic
 * equivalent is **GitHub Models** (and Azure OpenAI), which are OpenAI-compatible.
 * So this reuses the OpenAI adapter with GitHub's endpoint + token. Point
 * COPILOT_BASE_URL / token at your org's Copilot-backed gateway if you have one.
 */
import { makeOpenAI } from './openai.mjs';

export function makeCopilot(opts = {}) {
  const p = makeOpenAI({
    name: 'copilot',
    apiKey: opts.apiKey || process.env.GITHUB_MODELS_TOKEN || process.env.GITHUB_TOKEN,
    model: opts.model || process.env.COPILOT_MODEL || 'gpt-4o',
    baseURL: opts.baseURL || process.env.COPILOT_BASE_URL || 'https://models.inference.ai.azure.com',
  });
  return p;
}
