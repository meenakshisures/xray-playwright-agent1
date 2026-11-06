/**
 * Shared AST helpers for the verification gates. Uses the TypeScript compiler
 * API (already a devDependency) so parsing is robust against strings, comments,
 * nesting and chained matchers — things a regex would get wrong.
 *
 * Exports: parseSpec, extractTests, analyzeTest, matcherStrength, testIdFromTitle.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let ts;
try {
  ts = require('typescript');
} catch {
  console.error("[verify] The 'typescript' package is required. Run: npm install");
  process.exit(3);
}
export { ts };

/** Parse spec source text into a SourceFile (with parent pointers + trivia). */
export function parseSource(text, name = 'snippet.ts') {
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, /*setParentNodes*/ true, ts.ScriptKind.TS);
  return { sf, text };
}

/** Parse one spec file into a SourceFile. */
export function parseSpec(filePath) {
  return parseSource(readFileSync(filePath, 'utf8'), filePath);
}

/** Dotted callee name: `expect`, `test.skip`, `page.getByRole`, … */
function calleeName(expr) {
  if (!expr) return '';
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return calleeName(expr.expression) + '.' + expr.name.text;
  if (ts.isCallExpression(expr)) return calleeName(expr.expression);
  if (ts.isNonNullExpression(expr) || ts.isParenthesizedExpression(expr) || ts.isAwaitExpression(expr)) return calleeName(expr.expression);
  return '';
}

const TEST_BASES = new Set(['test', 'it']);

/** Is this call a test case? Returns its modifier (skip/only/fixme) or null. */
function classifyTestCall(name) {
  const parts = name.split('.');
  if (!TEST_BASES.has(parts[0])) return null;
  if (parts[1] === 'describe' || parts[1] === 'step' || parts[1] === 'use') return null; // containers, not cases
  return { modifier: parts[1] || null };
}

/** Read `// @ir-hash <hex>` from the comments just above a test() statement. */
function readIrHash(text, node) {
  const stmt = node.parent && ts.isExpressionStatement(node.parent) ? node.parent : node;
  for (const r of ts.getLeadingCommentRanges(text, stmt.getFullStart()) || []) {
    const m = text.slice(r.pos, r.end).match(/@ir-hash\s+([0-9a-f]+)/i);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

/** All test()/it() cases in a spec (describe blocks are walked, not counted). */
export function extractTests(ctx) {
  const tests = [];
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const cls = classifyTestCall(calleeName(node.expression));
      if (cls) {
        const titleArg = node.arguments[0];
        const title = titleArg && ts.isStringLiteralLike(titleArg) ? titleArg.text : null;
        const fn = node.arguments.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
        tests.push({ title, modifier: cls.modifier, node, fn, irHash: readIrHash(ctx.text, node) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ctx.sf);
  return tests;
}

// Higher = stronger. Value checks (3) > partial (2) > state (1) > existence (0).
const MATCHER_STRENGTH = {
  tohavetext: 3, tohavevalue: 3, tohavecount: 3, tohaveurl: 3, tohavetitle: 3,
  toequal: 3, tobe: 3, tostrictequal: 3, tohavescreenshot: 3, tohavejsproperty: 3,
  tocontaintext: 2, tohaveattribute: 2, tohaveclass: 2, tohavecss: 2, tomatch: 2, tocontain: 2,
  tobevisible: 1, tobechecked: 1, tobeenabled: 1, tobedisabled: 1, tobefocused: 1,
  tobehidden: 1, tobeeditable: 1, tobeintheviewport: 1, tobeempty: 1,
  tobeattached: 0, tobedefined: 0, tobetruthy: 0, tobenull: 0, tobefalsy: 0,
};
/** Strength of a matcher name; unknown matchers get a neutral 2. */
export function matcherStrength(m) {
  if (!m) return 2;
  const k = m.toLowerCase();
  return k in MATCHER_STRENGTH ? MATCHER_STRENGTH[k] : 2;
}

/** Normalize a @covers id: `TC-002:e1` and `e1` both compare as `e1`. */
export function normalizeId(id) {
  return id.includes(':') ? id.split(':').pop() : id;
}

/** Extract the test id from a title like "TC-002 Login fails…". */
export function testIdFromTitle(title) {
  const m = (title || '').match(/\b([A-Za-z]{2,}-[\w.]+)/);
  return m ? m[1] : null;
}

/** Walk up from an `expect(...)` call to read its matcher chain. */
function matcherChain(expectCall) {
  let cur = expectCall;
  const props = [];
  let argText = null;
  while (
    cur.parent &&
    (ts.isPropertyAccessExpression(cur.parent) ||
      ts.isCallExpression(cur.parent) ||
      ts.isAwaitExpression(cur.parent) ||
      ts.isParenthesizedExpression(cur.parent) ||
      ts.isNonNullExpression(cur.parent))
  ) {
    const p = cur.parent;
    if (ts.isPropertyAccessExpression(p)) props.push(p.name.text);
    if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression)) {
      const m = p.expression.name.text;
      if (m && m.startsWith('to') && p.arguments.length) argText = p.arguments[0].getText();
    }
    cur = p;
  }
  const negated = props.includes('not');
  const matcher = [...props].reverse().find((x) => x.startsWith('to')) || null;
  return { matcher, negated, argText };
}

/** True if a call expression is a global `expect(...)` / `expect.soft(...)`. */
function isExpectCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const c = node.expression;
  if (ts.isIdentifier(c) && c.text === 'expect') return true;
  if (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === 'expect') return true;
  return false;
}

/** First expect() matcher chain found inside a node (or null). */
function statementExpect(node) {
  let found = null;
  const v = (n) => {
    if (found) return;
    if (isExpectCall(n)) {
      found = matcherChain(n);
      return;
    }
    ts.forEachChild(n, v);
  };
  v(node);
  return found;
}

/** Read `@covers id1, id2` ids from a node's leading comments. */
function coversIds(text, node) {
  const ranges = ts.getLeadingCommentRanges(text, node.getFullStart()) || [];
  const ids = [];
  for (const r of ranges) {
    const m = text.slice(r.pos, r.end).match(/@covers\s+([^\n*]+)/i);
    if (m) m[1].split(/[,\s]+/).map((s) => s.trim()).filter(Boolean).forEach((id) => ids.push(id));
  }
  return ids;
}

function unwrap(node) {
  while (node && (ts.isAwaitExpression(node) || ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node))) {
    node = node.expression;
  }
  return node;
}

/**
 * Analyze one test body. Returns:
 *   expectAssertions: [{matcher, negated, argText}]
 *   coveredIds: Set of normalized ids from @covers tags
 *   idStrength: Map id -> max matcher strength seen for that id (null if POM-only)
 *   negatedSet: Set of `matcher:neg` signatures (for negation-flip detection)
 *   pomAssertions: count of tagged calls to expect/assert/verify-named POM methods
 *   coversNoCall: ids whose @covers tag sits on a non-call statement (warn)
 */
export function analyzeTest(test, ctx) {
  const { text } = ctx;
  const out = {
    expectAssertions: [],
    coveredIds: new Set(),
    idStrength: new Map(),
    negatedSet: new Set(),
    pomAssertions: 0,
    coversNoCall: [],
  };
  const body = test.fn && test.fn.body;
  if (!body) return out;

  // 1. all expect() assertions (global signal: count + negation set)
  const visitExpect = (node) => {
    if (isExpectCall(node)) {
      const chain = matcherChain(node);
      out.expectAssertions.push(chain);
      out.negatedSet.add(`${(chain.matcher || '?').toLowerCase()}:${chain.negated ? 'not' : 'pos'}`);
    }
    ts.forEachChild(node, visitExpect);
  };
  visitExpect(body);

  // 2. @covers tags + POM assertion calls, statement by statement
  const visitStmt = (node) => {
    if (ts.isExpressionStatement(node) || ts.isVariableStatement(node) || ts.isReturnStatement(node)) {
      const ids = coversIds(text, node);
      if (ids.length) {
        const expr = ts.isExpressionStatement(node) ? unwrap(node.expression) : null;
        const hasCall = !!expr && ts.isCallExpression(expr);
        const exp = statementExpect(node);
        const strength = exp ? matcherStrength(exp.matcher) : null;
        for (const raw of ids) {
          const id = normalizeId(raw);
          out.coveredIds.add(id);
          if (strength != null) {
            out.idStrength.set(id, Math.max(out.idStrength.get(id) ?? -1, strength));
          }
        }
        if (!hasCall) out.coversNoCall.push(...ids.map(normalizeId));
        // POM assertion: tagged call to a method named expect*/assert*/verify*…
        if (hasCall && !isExpectCall(expr)) {
          const method = calleeName(expr.expression).split('.').pop() || '';
          if (/^(expect|assert|verify|should|check)/i.test(method)) out.pomAssertions++;
        }
      }
    }
    ts.forEachChild(node, visitStmt);
  };
  visitStmt(body);

  return out;
}
