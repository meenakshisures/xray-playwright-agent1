#!/usr/bin/env node
/**
 * Self-heal guard (deterministic — no LLM).
 *
 * The failure-analyzer is told never to weaken an assertion to force a pass, but
 * a prompt rule is not a guarantee. This compares a spec BEFORE and AFTER a heal
 * attempt and BLOCKS the change if it made the test prove less:
 *   - dropped coverage of an expected result,
 *   - downgraded a matcher to a weaker one (e.g. toHaveText → toBeVisible),
 *   - flipped an assertion's negation,
 *   - reduced the number of assertions, or
 *   - added skip()/fixme().
 *
 * `diffSpecs` is pure (strings in, verdict out) for unit testing; the CLI reads
 * the two files and exits: 0 = OK to apply · 2 = BLOCKED · 3 = bad usage.
 *
 * Usage:  node scripts/heal-guard.mjs --before <path> --after <path>
 */
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseSource, extractTests, analyzeTest, testIdFromTitle } from './lib/ast.mjs';

/** Summarize each test() in spec source, keyed by test id. */
export function summarizeSource(text) {
  const ctx = parseSource(text);
  const map = new Map();
  for (const t of extractTests(ctx)) {
    const id = testIdFromTitle(t.title) || t.title || `#${map.size}`;
    const a = analyzeTest(t, ctx);
    map.set(id, {
      modifier: t.modifier,
      coveredIds: a.coveredIds,
      idStrength: a.idStrength,
      negatedSet: a.negatedSet,
      assertionCount: a.expectAssertions.length + a.pomAssertions,
    });
  }
  return map;
}

/** Compare before/after spec source. Returns { blocks: [], warns: [] }. */
export function diffSpecs(beforeText, afterText) {
  const before = summarizeSource(beforeText);
  const after = summarizeSource(afterText);
  const blocks = [];
  const warns = [];

  for (const [id, b] of before) {
    const a = after.get(id);
    if (!a) { blocks.push(`${id}: test disappeared after heal`); continue; }

    if ((a.modifier === 'skip' || a.modifier === 'fixme') && b.modifier !== a.modifier) {
      blocks.push(`${id}: heal added ${a.modifier}() — a skipped test verifies nothing`);
    }

    for (const cid of b.coveredIds) {
      if (!a.coveredIds.has(cid)) blocks.push(`${id}: coverage of "${cid}" was removed`);
    }

    for (const [cid, bs] of b.idStrength) {
      const as = a.idStrength.get(cid);
      if (as != null && bs != null && as < bs) {
        blocks.push(`${id}: assertion for "${cid}" weakened (strength ${bs} → ${as})`);
      }
      if (as == null && a.coveredIds.has(cid) && bs != null) {
        warns.push(`${id}: assertion for "${cid}" moved out of an expect() (now a POM/method call) — coverage kept`);
      }
    }

    for (const sig of b.negatedSet) {
      const [m, neg] = sig.split(':');
      const opposite = `${m}:${neg === 'not' ? 'pos' : 'not'}`;
      if (!a.negatedSet.has(sig) && a.negatedSet.has(opposite)) {
        blocks.push(`${id}: assertion "${m}" had its negation flipped (${neg} → ${neg === 'not' ? 'pos' : 'not'})`);
      }
    }

    if (a.assertionCount < b.assertionCount) {
      blocks.push(`${id}: assertion count dropped (${b.assertionCount} → ${a.assertionCount})`);
    }
  }
  return { blocks, warns };
}

// ---- CLI ----
function main() {
  const arg = (flag) => {
    const i = process.argv.indexOf(flag);
    return i !== -1 ? process.argv[i + 1] : null;
  };
  const beforePath = arg('--before');
  const afterPath = arg('--after');
  if (!beforePath || !afterPath || !existsSync(beforePath) || !existsSync(afterPath)) {
    console.error('Usage: node scripts/heal-guard.mjs --before <path> --after <path>');
    process.exit(3);
  }
  const { blocks, warns } = diffSpecs(readFileSync(beforePath, 'utf8'), readFileSync(afterPath, 'utf8'));
  if (blocks.length) {
    console.log('❌ HEAL BLOCKED — this change makes the test prove less. Route to a human:\n');
    for (const r of blocks) console.log(`  - ${r}`);
    if (warns.length) { console.log('\n  notes:'); for (const w of warns) console.log(`  - ${w}`); }
    process.exit(2);
  }
  console.log('✅ Heal OK — no assertion was removed, weakened, or negated.');
  for (const w of warns) console.log(`  note: ${w}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
