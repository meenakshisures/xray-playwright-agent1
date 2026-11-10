import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingParts, collectClarifications, buildClarificationCsv, buildClarificationMd } from '../scripts/clarify.mjs';

const OK = { testId: 'ID-1', title: 'ok', steps: ['do it'], expected: [{ id: 'ID-1-e1', description: 'it works' }] };
const NO_STEPS = { testId: 'ID-10', title: 'no steps', steps: ['(no steps provided)'], expected: [{ id: 'ID-10-e1', description: 'x' }], needsClarification: true, clarificationQuestions: ['ID-10: no steps found in Xray — what actions should the test perform?'] };
const NOTHING = { testId: 'ID-2', title: 'empty, "quoted"', steps: ['(no steps provided)'], expected: [{ id: 'ID-2-e1', description: '(no expected result provided)' }], needsClarification: true };

test('missingParts finds placeholder steps and expected results', () => {
  assert.deepEqual(missingParts(OK), []);
  assert.deepEqual(missingParts(NO_STEPS), ['steps']);
  assert.deepEqual(missingParts(NOTHING), ['steps', 'expected result']);
});

test('collectClarifications lists only incomplete tests, sorted naturally, with a fallback question', () => {
  const rows = collectClarifications([OK, NO_STEPS, NOTHING]);
  assert.deepEqual(rows.map((r) => r.testId), ['ID-2', 'ID-10']);
  assert.match(rows[0].questions[0], /ID-2/);
  assert.equal(rows[1].questions[0], NO_STEPS.clarificationQuestions[0]);
});

test('CSV and Markdown escape awkward characters and count complete tests', () => {
  const rows = collectClarifications([OK, NOTHING]);
  assert.match(buildClarificationCsv(rows), /"empty, ""quoted"""/);
  const md = buildClarificationMd(rows, 2);
  assert.match(md, /1 of 2 test\(s\) need clarification/);
  assert.match(md, /1 are complete/);
  assert.match(buildClarificationMd([], 3), /Nothing to clarify/);
});
