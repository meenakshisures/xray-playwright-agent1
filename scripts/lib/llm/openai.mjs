/** OpenAI (ChatGPT) provider — Chat Completions API. Dependency-free. */
export function makeOpenAI(opts = {}) {
  const apiKey = opts.apiKey || process.env.OPENAI_API_KEY;
  const model = opts.model || process.env.OPENAI_MODEL || 'gpt-4o';
  const baseURL = opts.baseURL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  return {
    name: opts.name || 'openai',
    model,
    async complete({ system, prompt, temperature = 0, maxTokens = 4096 } = {}) {
      if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
      const res = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          temperature,
          max_tokens: maxTokens,
          messages: [system ? { role: 'system', content: system } : null, { role: 'user', content: prompt }].filter(Boolean),
        }),
      });
      if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
      const data = await res.json();
      return { text: data.choices?.[0]?.message?.content || '', raw: data };
    },
  };
}
