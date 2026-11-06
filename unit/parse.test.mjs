import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, splitList, parseData, csvToIr, promptsToIr } from '../scripts/parse.mjs';

test('parseCsv handles quotes, commas and newlines inside fields', () => {
  const rows = parseCsv('a,b\n"x,y","line1\nline2"\n');
  assert.deepEqual(rows[0], ['a', 'b']);
  assert.equal(rows[1][0], 'x,y');
  assert.equal(rows[1][1], 'line1\nline2');
});

test('parseCsv unescapes doubled quotes', () => {
  const rows = parseCsv('h\n"he said ""hi"""\n');
  assert.equal(rows[1][0], 'he said "hi"');
});

test('parseCsv drops fully-blank rows', () => {
  assert.equal(parseCsv('a\n\n \nb\n').length, 2);
});

test('splitList splits numbered lists, newlines and semicolons', () => {
  assert.deepEqual(splitList('1. a\n2. b'), ['a', 'b']);
  assert.deepEqual(splitList('a; b; c'), ['a', 'b', 'c']);
  assert.deepEqual(splitList(''), []);
});

test('parseData parses key=value pairs, else _raw', () => {
  assert.deepEqual(parseData('k=v; k2=v2'), { k: 'v', k2: 'v2' });
  assert.deepEqual(parseData('just text'), { _raw: 'just text' });
  assert.deepEqual(parseData(''), {});
});

test('csvToIr assigns stable expected ids and honours the App column', () => {
  const rows = [
    ['TestID', 'Title', 'App', 'Expected Result'],
    ['T1', 'Title one', 'myapp', 'first\nsecond'],
  ];
  const ir = csvToIr(rows, 'defaultapp')[0];
  assert.equal(ir.app, 'myapp');
  assert.equal(ir.expected.length, 2);
  assert.deepEqual(ir.expected.map((e) => e.id), ['e1', 'e2']);
});

test('csvToIr falls back to the default app and placeholder expected', () => {
  const ir = csvToIr([['TestID', 'Title'], ['T2', 'No expected col']], 'da')[0];
  assert.equal(ir.app, 'da');
  assert.equal(ir.expected[0].id, 'e1');
  assert.match(ir.expected[0].description, /no expected result/i);
});

test('promptsToIr stubs each line and flags LLM normalization', () => {
  const stubs = promptsToIr('# comment\n\nVerify login\nVerify logout\n');
  assert.equal(stubs.length, 2);
  assert.equal(stubs[0].testId, 'PR-001');
  assert.equal(stubs[0].needsLlmNormalization, true);
});
