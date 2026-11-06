import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, extractTests, analyzeTest, matcherStrength, normalizeId, testIdFromTitle } from '../scripts/lib/ast.mjs';

const SPEC = `
import { test, expect } from '@playwright/test';
test('TC-9 demo', async ({ page }) => {
  // @covers TC-9:e1
  await expect(page.locator('.x')).toHaveText('1');
  await expect(page.locator('.y')).not.toBeVisible();
});
test.skip('TC-8 skipped', async () => {});
`;

test('extractTests finds cases, titles and modifiers', () => {
  const tests = extractTests(parseSource(SPEC));
  assert.equal(tests.length, 2);
  assert.equal(testIdFromTitle(tests[0].title), 'TC-9');
  assert.equal(tests[1].modifier, 'skip');
});

test('analyzeTest extracts assertions, coverage, strength and negation', () => {
  const ctx = parseSource(SPEC);
  const a = analyzeTest(extractTests(ctx)[0], ctx);
  assert.ok(a.coveredIds.has('e1'));
  assert.equal(a.expectAssertions.length, 2);
  assert.equal(a.idStrength.get('e1'), 3); // toHaveText = value check
  assert.ok([...a.negatedSet].some((s) => s === 'tobevisible:not'));
});

test('analyzeTest counts tagged POM assertion methods', () => {
  const ctx = parseSource(`test('TC-1 x', async ({ page }) => {
    // @covers TC-1:e1
    await page.expectLoaded();
  });`);
  const a = analyzeTest(extractTests(ctx)[0], ctx);
  assert.equal(a.pomAssertions, 1);
  assert.ok(a.coveredIds.has('e1'));
});

test('matcherStrength ranks value > state > existence, unknown = neutral', () => {
  assert.equal(matcherStrength('toHaveText'), 3);
  assert.equal(matcherStrength('toBeVisible'), 1);
  assert.equal(matcherStrength('toBeAttached'), 0);
  assert.equal(matcherStrength('toFancyThing'), 2);
});

test('normalizeId strips the testId prefix', () => {
  assert.equal(normalizeId('TC-9:e1'), 'e1');
  assert.equal(normalizeId('e2'), 'e2');
});
