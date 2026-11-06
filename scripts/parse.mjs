#!/usr/bin/env node
/**
 * Layer 1-2 (deterministic part): normalize raw inputs into Test Case IR.
 *
 *   - inputs/*.csv        -> fully normalized IR (one JSON file per row)
 *   - inputs/prompts.txt  -> stub IR flagged needsLlmNormalization=true
 *                            (the test-case-parser skill / LLM finishes these)
 *
 * A CSV row may carry an `App` column to target a specific app; otherwise the
 * APP env var (default "theinternet") is used. Pure functions are exported for
 * unit tests; file IO runs only when this script is invoked directly.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** RFC-4180-ish CSV parser: quotes, escaped quotes, commas + newlines in quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const HEADER_MAP = {
  testid: 'testId', id: 'testId',
  title: 'title', summary: 'title', name: 'title',
  app: 'app', application: 'app',
  preconditions: 'preconditions', precondition: 'preconditions', setup: 'preconditions',
  steps: 'steps', step: 'steps',
  testdata: 'testData', data: 'testData',
  expectedresult: 'expected', expectedresults: 'expected', expected: 'expected',
  priority: 'priority', tags: 'tags',
};
const normKey = (h) => h.trim().toLowerCase().replace(/[^a-z]/g, '');

/** Split a multi-step cell: numbered list, newlines, or semicolons. */
export function splitList(s) {
  if (!s) return [];
  return s
    .split(/\r?\n|;\s*/)
    .map((x) => x.replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter(Boolean);
}

/** Parse "key=value; key2=value2" into an object; fall back to { _raw }. */
export function parseData(s) {
  if (!s || !s.trim()) return {};
  if (!s.includes('=')) return { _raw: s.trim() };
  const out = {};
  for (const pair of s.split(/;|\n/)) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return out;
}

/** Rows (incl. header) -> IR records. `defaultApp` applies when no App column. */
export function csvToIr(rows, defaultApp = 'theinternet') {
  if (!rows.length) return [];
  const headers = rows[0].map(normKey).map((k) => HEADER_MAP[k] || k);
  const records = [];
  for (let r = 1; r < rows.length; r++) {
    const rec = {};
    headers.forEach((h, c) => (rec[h] = (rows[r][c] ?? '').trim()));

    const expected = splitList(rec.expected).map((d, i) => ({ id: `e${i + 1}`, description: d }));
    records.push({
      testId: rec.testId || `TC-${String(r).padStart(3, '0')}`,
      title: rec.title || '(untitled)',
      source: 'csv',
      app: rec.app || defaultApp,
      priority: (rec.priority || 'medium').toLowerCase(),
      preconditions: splitList(rec.preconditions),
      steps: splitList(rec.steps),
      testData: parseData(rec.testData),
      expected: expected.length ? expected : [{ id: 'e1', description: '(no expected result provided)' }],
      tags: splitList(rec.tags),
      needsClarification: expected.length === 0,
    });
  }
  return records;
}

/** prompts.txt text -> IR stubs flagged for LLM normalization. */
export function promptsToIr(text, defaultApp = 'theinternet') {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  return lines.map((line, i) => ({
    testId: `PR-${String(i + 1).padStart(3, '0')}`,
    title: line,
    source: 'prompt',
    app: defaultApp,
    priority: 'medium',
    preconditions: [],
    steps: [line],
    testData: {},
    expected: [{ id: 'e1', description: 'Derived by LLM from the prompt' }],
    tags: [],
    needsLlmNormalization: true,
  }));
}

// ---- CLI ----
function main() {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const IR_DIR = join(ROOT, 'ir');
  const APP = process.env.APP || 'theinternet';
  const INPUTS = join(ROOT, 'inputs');
  mkdirSync(IR_DIR, { recursive: true });

  const write = (records) => {
    for (const ir of records) writeFileSync(join(IR_DIR, `${ir.testId}.json`), JSON.stringify(ir, null, 2) + '\n');
    return records.length;
  };

  let total = 0;
  if (existsSync(INPUTS)) {
    for (const f of readdirSync(INPUTS).filter((f) => f.endsWith('.csv')).sort()) {
      const n = write(csvToIr(parseCsv(readFileSync(join(INPUTS, f), 'utf8')), APP));
      console.log(`CSV ${f} -> ${n} IR files`);
      total += n;
    }
    const promptPath = join(INPUTS, 'prompts.txt');
    if (existsSync(promptPath)) {
      const n = write(promptsToIr(readFileSync(promptPath, 'utf8'), APP));
      console.log(`Prompts -> ${n} IR stubs (needsLlmNormalization)`);
      total += n;
    }
  }
  console.log(`\nWrote ${total} test case(s) to ir/. Normalized CSV is generation-ready; prompt stubs await the LLM parser.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
