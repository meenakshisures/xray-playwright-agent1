#!/usr/bin/env node
/**
 * Orchestrator (the deterministic backbone of the agent's pipeline):
 *   parse inputs -> run Playwright -> generate report.
 *
 * The LLM-driven stages (normalize prompts, generate new specs, analyze+heal
 * failures) are performed by the test-author subagent via its skills; this
 * script is the plumbing those stages hang off, and runs the parts that must
 * be deterministic. Non-zero exit if any test failed (so CI fails honestly).
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const step = (label, cmd, args) => {
  console.log(`\n── ${label} ──`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  return r.status ?? 1;
};

step('1/6  Parse inputs -> IR', 'node', ['scripts/parse.mjs']);
// One consolidated list of tests with no steps / expected results (a report, never a gate).
step('2/6  Clarification report', 'node', ['scripts/clarify.mjs']);
// Gate 1: the generated code must compile. Invoked via node so it works even where the
// node_modules/.bin launchers are missing (see README Windows note).
const typeStatus = step('3/6  Type check (tsc)', 'node', ['node_modules/typescript/bin/tsc', '--noEmit']);
if (typeStatus !== 0) {
  console.log('\n✖ Type check FAILED — fix the compile errors above. Tests were not run.');
  process.exit(1);
}
// Gate 2: do every spec's assertions cover its expected results?
const verifyStatus = step('4/6  Verify assertion coverage', 'node', ['scripts/verify.mjs']);
// Tests may fail — that is expected input to the report, so don't abort here.
const testStatus = step('5/6  Execute Playwright specs', 'npx', ['playwright', 'test']);
// Pass the format through:  npm run agent -- --format html,csv   (default md)
const fi = process.argv.indexOf('--format');
step('6/6  Generate report', 'node', ['scripts/report.mjs', ...(fi === -1 ? [] : ['--format', process.argv[fi + 1] ?? ''])]);

if (verifyStatus !== 0) console.log('\n⚠  Verification FAILED — see reports/verification.md (a spec does not assert what its test case requires).');
console.log(`\nDone. See reports/report.md and reports/verification.md (\`npm run report:open\` for the HTML report).`);
process.exit(testStatus === 0 && verifyStatus === 0 ? 0 : 1);
