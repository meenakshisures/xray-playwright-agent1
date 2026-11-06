#!/usr/bin/env node
/**
 * Layer 1 adapter: Xray Cloud (Jira) -> Test Case IR.
 *
 *   node scripts/xray.mjs --jql "project = ABC AND issuetype = Test" [--app theinternet] [--limit 100] [--dry-run]
 *
 * Env (put in .env, never commit):
 *   XRAY_CLIENT_ID, XRAY_CLIENT_SECRET   Jira > Apps > Xray > Settings > API Keys
 *   XRAY_BASE_URL   default https://xray.cloud.getxray.app
 *                   EU: https://eu.xray.cloud.getxray.app  AU: https://au.xray.cloud.getxray.app
 *   XRAY_JQL        used when --jql is not passed
 *   APP             default app tag for IR (overridden by --app or an `app:<name>` Jira label)
 *
 * Output: ir/<KEY>.json (source "testmgmt"), same shape parse.mjs produces for CSV.
 * Pure mapping functions are exported for unit tests; network IO runs only from the CLI.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseData } from './parse.mjs';

const PAGE = 100; // Xray Cloud GraphQL max page size

export const TESTS_QUERY = `
query ($jql: String, $limit: Int!, $start: Int!) {
  getTests(jql: $jql, limit: $limit, start: $start) {
    total start limit
    results {
      issueId
      testType { name kind }
      steps { id action data result }
      gherkin
      unstructured
      preconditions(limit: 20) { results { issueId definition jira(fields: ["key"]) } }
      jira(fields: ["key", "summary", "priority", "labels"])
    }
  }
}`;

/** Strip Jira wiki / HTML markup down to plain text. */
export function clean(s) {
  if (s == null) return '';
  return String(s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\{(?:code|noformat)[^}]*\}/g, '')
    .replace(/\[([^\]|]+)\|[^\]]+\]/g, '$1') // [text|url] -> text
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

const PRIORITY = { highest: 'critical', blocker: 'critical', critical: 'critical', high: 'high', major: 'high',
  medium: 'medium', normal: 'medium', low: 'low', lowest: 'low', minor: 'low', trivial: 'low' };

/** Gherkin text -> { steps, expected }: Given/When/And-before-Then are steps, Then/And-after-Then expected. */
export function gherkinToParts(text) {
  const steps = [], expected = [];
  let inThen = false;
  for (const raw of clean(text).split('\n')) {
    const line = raw.trim();
    const m = line.match(/^(Given|When|Then|And|But)\s+(.*)$/i);
    if (!m) continue;
    const kw = m[1].toLowerCase();
    if (kw === 'then') inThen = true;
    else if (kw === 'given' || kw === 'when') inThen = false;
    (inThen ? expected : steps).push(m[2].trim());
  }
  return { steps, expected };
}

/** One Xray Cloud getTests result -> IR record. */
export function xrayTestToIr(t, defaultApp = 'theinternet', appOverride) {
  const jira = t.jira || {};
  const key = jira.key || `XRAY-${t.issueId}`;
  const labels = Array.isArray(jira.labels) ? jira.labels : [];
  const appLabel = labels.find((l) => /^app:/i.test(l));
  const app = appOverride || (appLabel ? appLabel.slice(4).trim() : defaultApp);
  const tags = labels.filter((l) => !/^app:/i.test(l));

  const preconditions = (t.preconditions?.results || [])
    .map((p) => clean(p.definition)).filter(Boolean);

  let steps = [], expected = [], testData = {};
  const kind = (t.testType?.kind || '').toLowerCase();

  if (kind === 'gherkin' || (!t.steps?.length && t.gherkin)) {
    ({ steps, expected } = gherkinToParts(t.gherkin));
    expected = expected.map((d, i) => ({ id: `${key}-e${i + 1}`, description: d }));
  } else if (kind === 'steps' || t.steps?.length) {
    const exp = [];
    t.steps.forEach((s, i) => {
      const action = clean(s.action);
      if (action) steps.push(action);
      const data = clean(s.data);
      if (data) {
        const parsed = parseData(data);
        if (parsed._raw !== undefined) testData[`step${i + 1}`] = parsed._raw;
        else Object.assign(testData, parsed);
      }
      const result = clean(s.result);
      if (result) exp.push({ id: `${key}-e${exp.length + 1}`, description: result });
    });
    expected = exp;
  } else if (t.unstructured) {
    steps = [clean(t.unstructured)];
  }

  const questions = [];
  if (!steps.length) questions.push(`${key}: no steps found in Xray — what actions should the test perform?`);
  if (!expected.length) questions.push(`${key}: no expected results in Xray — what should be asserted?`);

  return {
    testId: key,
    title: clean(jira.summary) || '(untitled)',
    source: 'testmgmt',
    app,
    priority: PRIORITY[String(jira.priority?.name ?? jira.priority ?? '').toLowerCase()] || 'medium',
    preconditions,
    steps: steps.length ? steps : ['(no steps provided)'],
    testData,
    expected: expected.length ? expected : [{ id: `${key}-e1`, description: '(no expected result provided)' }],
    tags,
    needsClarification: questions.length > 0,
    ...(questions.length ? { clarificationQuestions: questions } : {}),
  };
}

// ---- network (CLI only) ----
async function authenticate(base, id, secret) {
  const res = await fetch(`${base}/api/v2/authenticate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: id, client_secret: secret }),
  });
  if (!res.ok) throw new Error(`Xray auth failed: HTTP ${res.status} (check client id/secret and XRAY_BASE_URL region)`);
  return (await res.text()).replace(/"/g, '');
}

async function fetchAllTests(base, token, jql, max) {
  const out = [];
  for (let start = 0; out.length < max; start += PAGE) {
    const limit = Math.min(PAGE, max - out.length);
    const res = await fetch(`${base}/api/v2/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: TESTS_QUERY, variables: { jql, limit, start } }),
    });
    if (!res.ok) throw new Error(`Xray GraphQL failed: HTTP ${res.status}`);
    const body = await res.json();
    if (body.errors?.length) throw new Error(`Xray GraphQL error: ${body.errors.map((e) => e.message).join('; ')}`);
    const page = body.data.getTests;
    out.push(...page.results);
    if (start + page.results.length >= page.total || !page.results.length) break;
  }
  return out;
}

function loadDotEnv(root) {
  const p = join(root, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  loadDotEnv(ROOT);
  const { XRAY_CLIENT_ID: id, XRAY_CLIENT_SECRET: secret } = process.env;
  const base = (process.env.XRAY_BASE_URL || 'https://xray.cloud.getxray.app').replace(/\/$/, '');
  const jql = arg('jql') || process.env.XRAY_JQL;
  if (!id || !secret) throw new Error('Set XRAY_CLIENT_ID and XRAY_CLIENT_SECRET in .env');
  if (!jql) throw new Error('Provide --jql "project = ABC AND issuetype = Test" or set XRAY_JQL');

  const token = await authenticate(base, id, secret);
  const tests = await fetchAllTests(base, token, jql, Number(arg('limit')) || 1000);
  const records = tests.map((t) => xrayTestToIr(t, process.env.APP || 'theinternet', arg('app')));

  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify(records, null, 2));
  } else {
    const dir = join(ROOT, 'ir');
    mkdirSync(dir, { recursive: true });
    for (const ir of records) writeFileSync(join(dir, `${ir.testId}.json`), JSON.stringify(ir, null, 2) + '\n');
  }
  const flagged = records.filter((r) => r.needsClarification);
  console.log(`Xray: fetched ${records.length} test(s) for JQL [${jql}] -> ir/`);
  for (const r of flagged) console.log(`  ⚠ ${r.testId} needs clarification: ${r.clarificationQuestions.join(' | ')}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { console.error(`✖ ${e.message}`); process.exit(1); });
}
