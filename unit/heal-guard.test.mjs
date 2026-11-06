import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffSpecs } from '../scripts/heal-guard.mjs';

const BASE = `import { test, expect } from '@playwright/test';
test('TC-1 a', async ({ page }) => {
  // @covers TC-1:e1
  await expect(page.locator('.x')).toHaveText('1');
});`;

test('OK when only a selector changes (assertions untouched)', () => {
  const after = BASE.replace("locator('.x')", "getByTestId('x')");
  assert.equal(diffSpecs(BASE, after).blocks.length, 0);
});

test('BLOCK when a matcher is weakened', () => {
  const after = BASE.replace("toHaveText('1')", 'toBeVisible()');
  assert.ok(diffSpecs(BASE, after).blocks.some((b) => /weakened/.test(b)));
});

test('BLOCK when an assertion / coverage is removed', () => {
  const after = `import { test, expect } from '@playwright/test';
test('TC-1 a', async ({ page }) => { await page.goto('/'); });`;
  const { blocks } = diffSpecs(BASE, after);
  assert.ok(blocks.some((b) => /removed|count dropped/.test(b)));
});

test('BLOCK when skip() is added', () => {
  const after = BASE.replace("test('TC-1 a'", "test.skip('TC-1 a'");
  assert.ok(diffSpecs(BASE, after).blocks.some((b) => /skip/.test(b)));
});

test('BLOCK when a negation is flipped', () => {
  const base2 = BASE.replace("toHaveText('1')", 'toBeVisible()');
  const after2 = base2.replace('.toBeVisible()', '.not.toBeVisible()');
  assert.ok(diffSpecs(base2, after2).blocks.some((b) => /negation/.test(b)));
});
