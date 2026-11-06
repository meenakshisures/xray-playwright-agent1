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
