/** Anthropic Claude provider (Messages API). Dependency-free (global fetch). */
export function makeClaude(opts = {}) {
  const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
  const model = opts.model || process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
  const baseURL = opts.baseURL || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
  return {
    name: 'claude',
    model,
    async complete({ system, prompt, temperature = 0, maxTokens = 4096 } = {}) {
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
      const res = await fetch(`${baseURL}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature,
          ...(system ? { system } : {}),
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const text = (data.content || []).map((c) => c.text || '').join('');
      return { text, raw: data };
    },
  };
}
