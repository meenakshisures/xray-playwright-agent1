import { test } from 'node:test';
import assert from 'node:assert/strict';
import { irHash } from '../scripts/lib/irhash.mjs';
import { parseSource, extractTests } from '../scripts/lib/ast.mjs';
import { verifyTest } from '../scripts/verify.mjs';

const IR = {
  testId: 'TC-1', title: 'Login', app: 'x', priority: 'medium', tags: ['a'],
  preconditions: [], steps: ['Open page', 'Click go'], testData: { u: 'a' },
  expected: [{ id: 'TC-1-e1', description: 'Message shown' }],
};
const spec = (hash) => `
${hash ? `// @ir-hash ${hash}\n` : ''}test('TC-1 Login', async ({ page }) => {
  // @covers TC-1:TC-1-e1
  await expect(page.locator('.m')).toHaveText('x');
});`;
function run(src, ir = IR) {
  const ctx = parseSource(src);
  return verifyTest(extractTests(ctx)[0], ctx, ir);
}

test('hash is stable, ignores key order, priority and tags', () => {
  const reordered = { expected: IR.expected, steps: IR.steps, testData: IR.testData, preconditions: [], app: 'x', title: 'Login', tags: ['zzz'], priority: 'high' };
  assert.equal(irHash(IR), irHash(reordered));
  assert.match(irHash(IR), /^[0-9a-f]{12}$/);
});

test('hash changes when wording, a step, data or an expected id changes', () => {
  const base = irHash(IR);
  assert.notEqual(base, irHash({ ...IR, expected: [{ id: 'TC-1-e1', description: 'Message shown!' }] }));
  assert.notEqual(base, irHash({ ...IR, steps: ['Open page', 'Click stop'] }));
  assert.notEqual(base, irHash({ ...IR, testData: { u: 'b' } }));
  assert.notEqual(base, irHash({ ...IR, expected: [{ id: 'TC-1-e2', description: 'Message shown' }] }));
});

test('verify: matching @ir-hash passes', () => {
  assert.equal(run(spec(irHash(IR))).status, 'PASS');
});

test('verify: a changed IR makes the spec STALE (FAIL) even if ids still match', () => {
  const changed = { ...IR, expected: [{ id: 'TC-1-e1', description: 'Different wording' }] };
  const r = run(spec(irHash(IR)), changed);
  assert.equal(r.status, 'FAIL');
  assert.match(r.reasons.join(' '), /STALE/);
});

test('verify: missing @ir-hash is a WARN, not a pass', () => {
  const r = run(spec(null));
  assert.equal(r.status, 'WARN');
  assert.match(r.reasons.join(' '), /@ir-hash/);
});
