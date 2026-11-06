import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xrayTestToIr, gherkinToParts, clean } from '../scripts/xray.mjs';

const manual = {
  issueId: '1',
  testType: { name: 'Manual', kind: 'Steps' },
  jira: { key: 'ABC-12', summary: 'Add two items', priority: { name: 'High' }, labels: ['smoke', 'app:todomvc'] },
  preconditions: { results: [{ definition: '<p>App is open</p>' }] },
  steps: [
    { action: 'Type "a" and press Enter', data: 'text=a', result: 'Item a is listed' },
    { action: 'Type "b" and press Enter', data: 'free text', result: '' },
    { action: 'Look at the counter', data: '', result: '2 items left' },
  ],
};

test('manual Xray test maps to IR with ids, app label, data and expected', () => {
  const ir = xrayTestToIr(manual);
  assert.equal(ir.testId, 'ABC-12');
  assert.equal(ir.source, 'testmgmt');
  assert.equal(ir.app, 'todomvc');
  assert.equal(ir.priority, 'high');
  assert.deepEqual(ir.tags, ['smoke']);
  assert.deepEqual(ir.preconditions, ['App is open']);
  assert.equal(ir.steps.length, 3);
  assert.deepEqual(ir.testData, { text: 'a', step2: 'free text' });
  assert.deepEqual(ir.expected.map((e) => e.id), ['ABC-12-e1', 'ABC-12-e2']);
  assert.equal(ir.needsClarification, false);
});

test('app override beats label; missing expected is flagged, not invented', () => {
  const ir = xrayTestToIr({ ...manual, steps: [{ action: 'Do it', data: '', result: '' }] }, 'x', 'forced');
  assert.equal(ir.app, 'forced');
  assert.equal(ir.needsClarification, true);
  assert.match(ir.clarificationQuestions[0], /no expected/);
});

test('gherkin splits Given/When from Then', () => {
  const g = gherkinToParts('Given I am on the page\nWhen I click go\nThen I see done\nAnd I see more');
  assert.deepEqual(g.steps, ['I am on the page', 'I click go']);
  assert.deepEqual(g.expected, ['I see done', 'I see more']);
});

test('clean strips markup', () => {
  assert.equal(clean('<b>Hi</b>&nbsp;there[link|http://x]'), 'Hi therelink');
});
