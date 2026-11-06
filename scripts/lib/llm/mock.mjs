/**
 * Mock provider — deterministic, no network. Default so the pipeline (and unit
 * tests) run offline without any API key. Pass a custom `responder(req)` to
 * script responses in tests.
 */
export function makeMock(opts = {}) {
  const responder = opts.responder || ((req) => `MOCK(${(req.prompt || '').slice(0, 60)})`);
  return {
    name: 'mock',
    model: opts.model || 'mock',
    async complete(req = {}) {
      return { text: responder(req), raw: { mock: true, req } };
    },
  };
}
