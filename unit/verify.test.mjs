import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, extractTests } from '../scripts/lib/ast.mjs';
import { verifyTest } from '../scripts/verify.mjs';

const IR = { expected: [{ id: 'e1', description: 'something' }] };

function firstTest(src) {
  const ctx = parseSource(src);
  return { ctx, test: extractTests(ctx)[0] };
}

test('PASS when the expected result is covered by a tagged assertion', () => {
  const { ctx, test: t } = firstTest(`test('TC-1 a', async ({ page }) => {
    // @covers TC-1:e1
    await expect(page.locator('.x')).toHaveText('1');
  });`);
  assert.equal(verifyTest(t, ctx, IR).status, 'PASS');
});

test('FAIL when an expected result is not covered', () => {
  const { ctx, test: t } = firstTest(`test('TC-1 a', async ({ page }) => {
    await expect(page.locator('.x')).toBeVisible();
  });`);
  const r = verifyTest(t, ctx, IR);
  assert.equal(r.status, 'FAIL');
  assert.match(r.reasons.join(' '), /not covered/);
});

test('FAIL on a stale @covers id', () => {
  const { ctx, test: t } = firstTest(`test('TC-1 a', async ({ page }) => {
    // @covers TC-1:e9
    await expect(page.locator('.x')).toBeVisible();
  });`);
  assert.match(verifyTest(t, ctx, IR).reasons.join(' '), /unknown expected id/);
});

test('FAIL when the test has no assertions', () => {
  const { ctx, test: t } = firstTest(`test('TC-1 a', async ({ page }) => { await page.goto('/'); });`);
  assert.match(verifyTest(t, ctx, IR).reasons.join(' '), /no assertions/);
});

test('FAIL on a skipped test', () => {
  const { ctx, test: t } = firstTest(`test.skip('TC-1 a', async () => {});`);
  assert.equal(verifyTest(t, ctx, IR).status, 'FAIL');
});

test('FAIL when the source IR is not assertable', () => {
  const { ctx, test: t } = firstTest(`test('TC-1 a', async ({ page }) => {
    // @covers TC-1:e1
    await expect(page.locator('.x')).toBeVisible();
  });`);
  const r = verifyTest(t, ctx, { needsClarification: true, expected: [{ id: 'e1', description: 'x' }] });
  assert.equal(r.status, 'FAIL');
});

test('WARN when the spec is untraced (no IR)', () => {
  const { ctx, test: t } = firstTest(`test('TC-1 a', async ({ page }) => {
    await expect(page.locator('.x')).toBeVisible();
  });`);
  assert.equal(verifyTest(t, ctx, null).status, 'WARN');
});
