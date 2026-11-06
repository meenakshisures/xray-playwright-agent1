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

step('1/4  Parse inputs -> IR', 'node', ['scripts/parse.mjs']);
// Static verification gate: do every spec's assertions cover its expected results?
const verifyStatus = step('2/4  Verify assertion coverage', 'node', ['scripts/verify.mjs']);
// Tests may fail — that is expected input to the report, so don't abort here.
const testStatus = step('3/4  Execute Playwright specs', 'npx', ['playwright', 'test']);
step('4/4  Generate Markdown report', 'node', ['scripts/report.mjs']);

if (verifyStatus !== 0) console.log('\n⚠  Verification FAILED — see reports/verification.md (a spec does not assert what its test case requires).');
console.log(`\nDone. See reports/report.md and reports/verification.md (\`npm run report:open\` for the HTML report).`);
process.exit(testStatus === 0 && verifyStatus === 0 ? 0 : 1);
