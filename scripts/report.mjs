#!/usr/bin/env node
/**
 * Layer 8 (deterministic): turn Playwright's JSON result into a per-test-case
 * Markdown report. Status is never swallowed: every spec appears with its
 * status and, on failure, the error reason and links to trace/screenshot.
 *
 * `flattenSpecs` and `buildReport` are pure (for unit tests); the CLI reads
 * reports/results.json and writes reports/report.md.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Playwright nests suites arbitrarily deep; flatten to a list of specs. */
export function flattenSpecs(data, rootForPaths = '') {
  const specs = [];
  const rel = (p) => (p && rootForPaths ? relative(rootForPaths, p) : p || '');
  const walk = (suite) => {
    for (const s of suite.suites || []) walk(s);
    for (const spec of suite.specs || []) {
      const test = spec.tests?.[0];
      const result = test?.results?.[test.results.length - 1];
      specs.push({
        title: spec.title,
        file: spec.file,
        outcome: result?.status || test?.status || 'unknown', // passed|failed|timedOut|skipped
        durationMs: result?.duration || 0,
        error: result?.error?.message?.split('\n')[0] || '',
        retries: (test?.results?.length || 1) - 1,
        attachments: (result?.attachments || []).map((a) => ({ name: a.name, path: rel(a.path) })),
      });
    }
  };
  for (const s of data.suites || []) walk(s);
  return specs;
}

/** Build the Markdown report + counts from Playwright JSON. */
export function buildReport(data, rootForPaths = '') {
  const specs = flattenSpecs(data, rootForPaths);
  const pass = specs.filter((s) => s.outcome === 'passed').length;
  const fail = specs.filter((s) => s.outcome === 'failed' || s.outcome === 'timedOut').length;
  const skipped = specs.filter((s) => s.outcome === 'skipped').length;
  const total = specs.length;
  const rate = total ? Math.round((pass / total) * 100) : 0;

  const icon = (o) => ({ passed: '✅', failed: '❌', timedOut: '⏱️', skipped: '⚪' }[o] || '❓');
  const clean = (s) => (s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

  let md = `# Test Automation Agent — Run Report\n\n_Generated ${new Date().toISOString()}_\n\n`;
  md += `**${pass}/${total} passed (${rate}%)** · ${fail} failed · ${skipped} skipped\n\n`;
  md += `| Status | Test case | Duration | Retries | Reason (on failure) |\n`;
  md += `|:------:|-----------|---------:|:-------:|---------------------|\n`;
  for (const s of specs) {
    md += `| ${icon(s.outcome)} | ${clean(s.title)} | ${(s.durationMs / 1000).toFixed(1)}s | ${s.retries} | ${clean(s.error) || '—'} |\n`;
  }

  const failures = specs.filter((s) => s.outcome === 'failed' || s.outcome === 'timedOut');
  if (failures.length) {
    md += `\n## Failure detail\n\n`;
    for (const f of failures) {
      md += `### ❌ ${f.title}\n\n- **File:** \`${f.file}\`\n- **Reason:** ${clean(f.error) || 'unknown'}\n`;
      for (const a of f.attachments) md += `- **${a.name}:** \`${a.path}\`\n`;
      md += `\n`;
    }
  }
  md += `\n---\nFull interactive report: \`npm run report:open\`. Traces: \`npx playwright show-trace <trace.zip>\`.\n`;
  return { md, counts: { pass, fail, skipped, total, rate } };
}

// ---- CLI ----
function main() {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const RESULTS = join(ROOT, 'reports', 'results.json');
  const OUT = join(ROOT, 'reports', 'report.md');
  if (!existsSync(RESULTS)) {
    console.error(`No results at ${relative(ROOT, RESULTS)} — run \`npm test\` first.`);
    process.exit(1);
  }
  const { md, counts } = buildReport(JSON.parse(readFileSync(RESULTS, 'utf8')), ROOT);
  writeFileSync(OUT, md);
  console.log(`Wrote ${relative(ROOT, OUT)} — ${counts.pass}/${counts.total} passed (${counts.rate}%).`);
  if (counts.fail > 0) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
