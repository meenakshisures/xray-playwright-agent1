#!/usr/bin/env node
/**
 * Clarification report (deterministic — no LLM).
 *
 * Tests whose source (Xray, CSV, prompt) has no steps or no expected result cannot be
 * migrated without guessing, and the agent must never invent them. Instead of asking about
 * each one in chat, this lists every such test in ONE report so the test owners can fix
 * them in bulk and the complete tests can be migrated now.
 *
 * Reads ir/*.json and writes reports/clarification.md and reports/clarification.csv.
 * Exit code is 0 either way (this is a report, not a gate; `verify` is the gate).
 *
 * Usage:  node scripts/clarify.mjs
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const NO_STEPS = /no steps provided/i;
const NO_EXPECTED = /no expected result/i;

/** What is missing from one IR? Returns [] when the test is complete. */
export function missingParts(ir) {
  const missing = [];
  const steps = Array.isArray(ir.steps) ? ir.steps : [];
  if (!steps.length || steps.every((s) => NO_STEPS.test(String(s)))) missing.push('steps');
  const expected = Array.isArray(ir.expected) ? ir.expected : [];
  if (!expected.length || expected.every((e) => NO_EXPECTED.test(String(e?.description ?? '')))) missing.push('expected result');
  return missing;
}

/** Collect the tests that need clarification, sorted by id. Pure: IR objects in, rows out. */
export function collectClarifications(irs) {
  const rows = [];
  for (const ir of irs) {
    const missing = missingParts(ir);
    if (!ir.needsClarification && !missing.length) continue;
    const questions = ir.clarificationQuestions?.length
      ? ir.clarificationQuestions
      : [`${ir.testId}: ${missing.length ? `no ${missing.join(' or ')} found` : 'needs clarification'} — what should the test do and assert?`];
    rows.push({ testId: ir.testId, title: ir.title || '', source: ir.source || '', priority: ir.priority || '', missing, questions });
  }
  return rows.sort((a, b) => String(a.testId).localeCompare(String(b.testId), undefined, { numeric: true }));
}

const csvCell = (v) => {
  const t = String(v ?? '');
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export function buildClarificationCsv(rows) {
  const lines = [['test_id', 'title', 'source', 'priority', 'missing', 'question_for_owner']];
  for (const r of rows) lines.push([r.testId, r.title, r.source, r.priority, r.missing.join(' + '), r.questions.join(' | ')]);
  return lines.map((l) => l.map(csvCell).join(',')).join('\n') + '\n';
}

export function buildClarificationMd(rows, total) {
  const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  let md = `# Clarification Report — tests that cannot be migrated yet\n\n_Generated ${new Date().toISOString()}_\n\n`;
  md += `**${rows.length} of ${total} test(s) need clarification.** ${total - rows.length} are complete and can be migrated now.\n\n`;
  if (!rows.length) return md + `Nothing to clarify.\n`;
  md += `The agent never invents steps or expected results. Please add the missing information in the source, then re-fetch.\n\n`;
  md += `| Test | Title | Priority | Missing | Question for the owner |\n|------|-------|:--------:|---------|------------------------|\n`;
  for (const r of rows) md += `| ${cell(r.testId)} | ${cell(r.title)} | ${cell(r.priority)} | ${cell(r.missing.join(' + ') || '—')} | ${cell(r.questions.join(' | '))} |\n`;
  return md;
}

// ---- CLI ----
function main() {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const IR_DIR = join(ROOT, 'ir');
  const REPORTS = join(ROOT, 'reports');
  if (!existsSync(IR_DIR)) { console.error('No ir/ folder — fetch or parse test cases first.'); process.exit(1); }
  const irs = [];
  for (const f of readdirSync(IR_DIR).filter((n) => /\.json$/.test(n) && n !== 'schema.json')) {
    try { irs.push(JSON.parse(readFileSync(join(IR_DIR, f), 'utf8'))); } catch { console.error(`Skipping unreadable ${f}`); }
  }
  const rows = collectClarifications(irs);
  mkdirSync(REPORTS, { recursive: true });
  writeFileSync(join(REPORTS, 'clarification.md'), buildClarificationMd(rows, irs.length));
  writeFileSync(join(REPORTS, 'clarification.csv'), buildClarificationCsv(rows));
  console.log(`Clarification: ${rows.length} of ${irs.length} test(s) need input → reports/clarification.md, reports/clarification.csv`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
