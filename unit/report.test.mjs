import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenSpecs, buildReport } from '../scripts/report.mjs';

const DATA = {
  suites: [
    {
      specs: [
        { title: 'A passes', file: 'a.spec.ts', tests: [{ status: 'expected', results: [{ status: 'passed', duration: 100, attachments: [] }] }] },
      ],
      suites: [
        {
          specs: [
            { title: 'B fails', file: 'b.spec.ts', tests: [{ status: 'unexpected', results: [{ status: 'failed', duration: 200, error: { message: 'boom\nstacktrace' }, attachments: [{ name: 'trace', path: '/x/trace.zip' }] }] }] },
          ],
        },
      ],
    },
  ],
};

test('flattenSpecs walks nested suites', () => {
  const specs = flattenSpecs(DATA);
  assert.equal(specs.length, 2);
  assert.equal(specs.find((s) => s.title === 'B fails').outcome, 'failed');
});

test('buildReport computes counts and surfaces the failure reason', () => {
  const { md, counts } = buildReport(DATA);
  assert.deepEqual({ pass: counts.pass, fail: counts.fail, total: counts.total }, { pass: 1, fail: 1, total: 2 });
  assert.equal(counts.rate, 50);
  assert.match(md, /boom/);
  assert.match(md, /Failure detail/);
});

import { buildCsv, buildJunit, buildJson, buildHtml, parseFormats } from '../scripts/report.mjs';

test('alternative formats: csv, junit, json, html', () => {
  const specs = flattenSpecs(DATA);
  const { counts } = buildReport(DATA);
  assert.match(buildCsv(specs), /^test,status,duration_s,retries,reason,file\n/);
  assert.match(buildCsv(specs), /B fails,failed,0\.2,0,boom,b\.spec\.ts/);
  const junit = buildJunit(specs, counts);
  assert.match(junit, /<testsuites tests="2" failures="1"/);
  assert.match(junit, /<failure message="boom"\/>/);
  assert.equal(JSON.parse(buildJson(specs, counts)).counts.fail, 1);
  assert.match(buildHtml(specs, counts), /1\/2 passed \(50%\)/);
});

test('parseFormats defaults to md, accepts lists and all, and rejects unknown formats', () => {
  assert.deepEqual(parseFormats(undefined).formats, ['md']);
  assert.deepEqual(parseFormats('html, CSV').formats, ['html', 'csv']);
  assert.equal(parseFormats('all').formats.length, 5);
  assert.match(parseFormats('pdf').error, /Unknown format "pdf"/);
});

import { cleanError } from '../scripts/report.mjs';

test('cleanError strips ANSI colour codes and keeps the useful lines', () => {
  const raw = 'Error: \u001b[2mexpect(\u001b[22m\u001b[31mlocator\u001b[39m\u001b[2m).\u001b[22mtoBeVisible\u001b[2m(\u001b[22m\u001b[2m)\u001b[22m failed\n\nLocator: getByText(\'x\')\nExpected: visible\nTimeout: 7000ms\n\nCall log:\n  - waiting';
  assert.equal(cleanError(raw), "Error: expect(locator).toBeVisible() failed · Locator: getByText('x') · Expected: visible");
  assert.equal(cleanError(undefined), '');
});
