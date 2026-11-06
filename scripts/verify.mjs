#!/usr/bin/env node
/**
 * Verification gate (static, deterministic — no LLM).
 *
 * Proves that every generated spec actually asserts what its source test case
 * said it should. This is the defense against the dangerous LLM failure: a spec
 * that passes while checking the wrong thing, or nothing.
 *
 * For each test() it:
 *   - finds the source IR by the test id in the title (e.g. "TC-002 …"),
 *   - requires each IR `expected` entry to be covered by a `@covers <id>` tag,
 *   - requires at least one real assertion in the test,
 *   - rejects stale @covers ids, skipped/focused tests, and non-assertable IR.
 *
 * `verifyTest` is pure (IR passed in) for unit testing; the CLI loads IR from
 * disk, writes reports/verification.{json,md}, and exits non-zero on any FAIL.
 *
 * Usage:  node scripts/verify.mjs [tests/foo.spec.ts ...]   (default: all specs)
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseSpec, extractTests, analyzeTest, testIdFromTitle } from './lib/ast.mjs';
import { irHash } from './lib/irhash.mjs';

/**
 * Verify one test() against its IR (or null if untraced).
 * Returns { testId, title, status: PASS|WARN|FAIL, reasons[], info }.
 */
export function verifyTest(test, ctx, ir) {
  const reasons = [];
  const title = test.title || '(no title)';
  const testId = testIdFromTitle(title);

  if (test.modifier === 'skip' || test.modifier === 'fixme') {
    return { testId, title, status: 'FAIL', reasons: [`test is ${test.modifier}() — a skipped test verifies nothing`] };
  }
  if (test.modifier === 'only') {
    reasons.push('test is only() — would hide other tests in CI; remove before merge');
  }
  if (!testId) return { testId: null, title, status: 'WARN', reasons: ['no test id in title — cannot trace to a source test case'] };
  if (!ir) return { testId, title, status: 'WARN', reasons: [`no IR found (ir/${testId}.json) — spec is untraced`] };

  const notAssertable =
    ir.needsClarification ||
    ir.needsLlmNormalization ||
    !Array.isArray(ir.expected) ||
    ir.expected.length === 0 ||
    ir.expected.some((e) => /no expected result/i.test(e.description || ''));
  if (notAssertable) {
    return { testId, title, status: 'FAIL', reasons: ['source IR has no assertable expected result (needs clarification) — do not migrate silently'] };
  }

  const a = analyzeTest(test, ctx);
  const expectedIds = ir.expected.map((e, i) => e.id || `e${i + 1}`);
  const assertionCount = a.expectAssertions.length + a.pomAssertions;

  if (assertionCount === 0) reasons.push('no assertions found — the test proves nothing');

  const missing = expectedIds.filter((id) => !a.coveredIds.has(id));
  if (missing.length) {
    reasons.push(`expected result(s) not covered by any assertion: ${missing.join(', ')} ` +
      `(add a "// @covers ${testId}:${missing[0]}" tag on the asserting line)`);
  }

  const stale = [...a.coveredIds].filter((id) => !expectedIds.includes(id));
  if (stale.length) reasons.push(`@covers references unknown expected id(s): ${stale.join(', ')}`);

  const warnReasons = a.coversNoCall.length
    ? [`@covers tag(s) on a non-asserting line: ${[...new Set(a.coversNoCall)].join(', ')}`]
    : [];

  // Freshness: has the source test case changed since this spec was generated?
  // Only checked for a real IR (one that has steps); tiny test fixtures are skipped.
  if (Array.isArray(ir.steps)) {
    const want = irHash(ir);
    if (!test.irHash) {
      warnReasons.push(`no "// @ir-hash" tag above the test — cannot tell if it is up to date with the source test case (current: ${want})`);
    } else if (test.irHash !== want) {
      reasons.push(`STALE: the source test case changed after this spec was generated (spec @ir-hash ${test.irHash}, current ${want}) — regenerate it from ir/${testId}.json`);
    }
  }

  const hardFail = reasons.length > 0;
  return {
    testId,
    title,
    status: hardFail ? 'FAIL' : warnReasons.length ? 'WARN' : 'PASS',
    reasons: [...reasons, ...warnReasons],
    info: { assertionCount, coverage: `${expectedIds.length - missing.length}/${expectedIds.length}` },
  };
}

// ---- CLI ----
function main() {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const IR_DIR = join(ROOT, 'ir');
  const TESTS_DIR = join(ROOT, 'tests');
  const REPORTS = join(ROOT, 'reports');
  mkdirSync(REPORTS, { recursive: true });

  const specFiles = () => {
    const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
    if (args.length) return args.map((a) => (a.startsWith('/') ? a : join(ROOT, a)));
    const out = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.spec\.ts$/.test(e.name)) out.push(p);
      }
    };
    if (existsSync(TESTS_DIR)) walk(TESTS_DIR);
    return out;
  };
  const loadIr = (testId) => {
    const p = join(IR_DIR, `${testId}.json`);
    if (!existsSync(p)) return null;
    try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
  };

  const results = [];
  for (const f of specFiles()) {
    let ctx;
    try { ctx = parseSpec(f); }
    catch (err) {
      results.push({ file: relative(ROOT, f), testId: null, title: '(parse error)', status: 'FAIL', reasons: [String(err.message || err)] });
      continue;
    }
    const tests = extractTests(ctx);
    if (!tests.length) { results.push({ file: relative(ROOT, f), title: '(file)', status: 'WARN', reasons: ['no test() cases found'] }); continue; }
    for (const t of tests) {
      const id = testIdFromTitle(t.title);
      results.push({ file: relative(ROOT, f), ...verifyTest(t, ctx, id ? loadIr(id) : null) });
    }
  }

  const counts = { PASS: 0, WARN: 0, FAIL: 0 };
  for (const r of results) counts[r.status]++;

  const icon = (s) => ({ PASS: '✅', WARN: '⚠️', FAIL: '❌' }[s]);
  let md = `# Verification Gate — Assertion Coverage\n\n_Generated ${new Date().toISOString()}_\n\n`;
  md += `**${counts.PASS} passed · ${counts.WARN} warnings · ${counts.FAIL} failed**\n\n`;
  md += `| Status | Test | Coverage | Asserts | Notes |\n|:--:|------|:--:|:--:|------|\n`;
  for (const r of results) {
    md += `| ${icon(r.status)} | ${(r.testId || r.title).replace(/\|/g, '\\|')} | ${r.info?.coverage ?? '—'} | ${r.info?.assertionCount ?? '—'} | ${(r.reasons.join('; ') || '—').replace(/\|/g, '\\|')} |\n`;
  }
  writeFileSync(join(REPORTS, 'verification.md'), md);
  writeFileSync(join(REPORTS, 'verification.json'), JSON.stringify({ counts, results }, null, 2) + '\n');

  for (const r of results) if (r.status !== 'PASS') console.log(`${icon(r.status)} ${r.file} › ${r.testId || r.title}: ${r.reasons.join('; ')}`);
  console.log(`\nVerification: ${counts.PASS} pass · ${counts.WARN} warn · ${counts.FAIL} fail → reports/verification.md`);
  if (counts.FAIL > 0) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
