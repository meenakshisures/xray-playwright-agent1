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

/**
 * Turn a raw Playwright error message into a short, readable reason.
 * Playwright colours its messages with ANSI escape codes (shown as "[2m", "[31m"...
 * when printed as plain text), so strip those, then keep the headline plus the
 * Locator / Expected / Received lines, e.g.
 *   "Error: expect(locator).toBeVisible() failed · Locator: getByText('...') · Expected: visible"
 */
export function cleanError(message) {
  if (!message) return '';
  const plain = String(message).replace(/\u001b\[[0-9;]*m/g, '');
  const lines = plain.split('\n').map((l) => l.trim()).filter(Boolean);
  const headline = lines[0] || '';
  const detail = lines.slice(1).filter((l) => /^(Locator|Expected|Received):/.test(l));
  return [headline, ...detail].join(' · ').slice(0, 400);
}

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
        error: cleanError(result?.error?.message),
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

// ---- Alternative output formats (pure: specs/counts in, string out) ----
export const FORMATS = ['md', 'html', 'json', 'junit', 'csv'];

const isFail = (s) => s.outcome === 'failed' || s.outcome === 'timedOut';
const xmlEsc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const csvCell = (v) => {
  const t = String(v ?? '');
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** CSV: one row per test case. */
export function buildCsv(specs) {
  const rows = [['test', 'status', 'duration_s', 'retries', 'reason', 'file']];
  for (const s of specs) rows.push([s.title, s.outcome, (s.durationMs / 1000).toFixed(1), s.retries, s.error, s.file]);
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

/** JUnit XML: understood by most CI systems and test dashboards. */
export function buildJunit(specs, counts) {
  let x = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  x += `<testsuites tests="${counts.total}" failures="${counts.fail}" skipped="${counts.skipped}">\n`;
  x += `  <testsuite name="playwright" tests="${counts.total}" failures="${counts.fail}" skipped="${counts.skipped}">\n`;
  for (const s of specs) {
    x += `    <testcase name="${xmlEsc(s.title)}" classname="${xmlEsc(s.file)}" time="${(s.durationMs / 1000).toFixed(3)}"`;
    if (isFail(s)) x += `>\n      <failure message="${xmlEsc(s.error || s.outcome)}"/>\n    </testcase>\n`;
    else if (s.outcome === 'skipped') x += `>\n      <skipped/>\n    </testcase>\n`;
    else x += `/>\n`;
  }
  return x + `  </testsuite>\n</testsuites>\n`;
}

/** JSON: counts plus every spec, for dashboards or other tools. */
export function buildJson(specs, counts) {
  return JSON.stringify({ generated: new Date().toISOString(), counts, specs }, null, 2) + '\n';
}

/** Self-contained HTML summary (no external assets). The full Playwright report is `npm run report:open`. */
export function buildHtml(specs, counts) {
  const color = (o) => (o === 'passed' ? '#1a7f37' : o === 'skipped' ? '#6b6f80' : '#c8453b');
  const rows = specs
    .map((s) => `<tr><td style="color:${color(s.outcome)};font-weight:600">${xmlEsc(s.outcome)}</td><td>${xmlEsc(s.title)}</td>` +
      `<td>${(s.durationMs / 1000).toFixed(1)}s</td><td>${s.retries}</td><td>${xmlEsc(s.error) || '—'}</td></tr>`)
    .join('\n');
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>Test run report</title>
<style>body{font-family:Arial,sans-serif;margin:24px;color:#2b2d42}table{border-collapse:collapse;width:100%}
th,td{border:1px solid #e3e3e8;padding:6px 10px;text-align:left;font-size:14px}th{background:#f4f4f7}</style></head>
<body><h1>Test Automation Agent — Run Report</h1>
<p><strong>${counts.pass}/${counts.total} passed (${counts.rate}%)</strong> · ${counts.fail} failed · ${counts.skipped} skipped</p>
<table><thead><tr><th>Status</th><th>Test case</th><th>Duration</th><th>Retries</th><th>Reason (on failure)</th></tr></thead>
<tbody>
${rows}
</tbody></table></body></html>\n`;
}

/** Parse `--format md,html` (or `all`). Returns { formats } or { error }. */
export function parseFormats(arg) {
  if (!arg) return { formats: ['md'] };
  const wanted = String(arg).toLowerCase() === 'all' ? FORMATS : String(arg).toLowerCase().split(',').map((f) => f.trim()).filter(Boolean);
  const bad = wanted.filter((f) => !FORMATS.includes(f));
  if (bad.length || !wanted.length) return { error: `Unknown format "${bad.join(', ') || arg}". Use: ${FORMATS.join(', ')}, or all.` };
  return { formats: [...new Set(wanted)] };
}

// ---- CLI ----
// Usage: node scripts/report.mjs [--format md|html|json|junit|csv|all]   (comma-separate to get several; default md)
function main() {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const RESULTS = join(ROOT, 'reports', 'results.json');
  const fi = process.argv.indexOf('--format');
  const { formats, error } = parseFormats(fi === -1 ? undefined : process.argv[fi + 1]);
  if (error) { console.error(error); process.exit(3); }
  if (!existsSync(RESULTS)) {
    console.error(`No results at ${relative(ROOT, RESULTS)} — run \`npm test\` first.`);
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(RESULTS, 'utf8'));
  const { md, counts } = buildReport(data, ROOT);
  const specs = flattenSpecs(data, ROOT);
  const outputs = {
    md: ['report.md', () => md],
    html: ['report.html', () => buildHtml(specs, counts)],
    json: ['report.json', () => buildJson(specs, counts)],
    junit: ['junit.xml', () => buildJunit(specs, counts)],
    csv: ['report.csv', () => buildCsv(specs)],
  };
  for (const f of formats) {
    const [file, make] = outputs[f];
    writeFileSync(join(ROOT, 'reports', file), make());
    console.log(`Wrote reports/${file}`);
  }
  console.log(`${counts.pass}/${counts.total} passed (${counts.rate}%).`);
  if (counts.fail > 0) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
