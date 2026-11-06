/**
 * Fingerprint of a Test Case IR (deterministic — no LLM).
 *
 * Covers everything that changes what the generated spec must do: title, app,
 * preconditions, steps, test data and expected results (ids + text). It ignores
 * fields that do not change the test's meaning (priority, tags, flags).
 *
 * The spec carries this value in a `// @ir-hash <value>` comment above its
 * test(); `verify` recomputes it from ir/<id>.json and fails the spec if they
 * differ, i.e. the source test case changed after the spec was generated.
 */
import { createHash } from 'node:crypto';

/** JSON.stringify with object keys sorted, so key order never changes the hash. */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export function irHash(ir) {
  const core = {
    title: ir.title ?? '',
    app: ir.app ?? '',
    preconditions: ir.preconditions ?? [],
    steps: ir.steps ?? [],
    testData: ir.testData ?? {},
    expected: (ir.expected ?? []).map((e) => ({ id: e.id, description: e.description })),
  };
  return createHash('sha256').update(canonical(core)).digest('hex').slice(0, 12);
}
