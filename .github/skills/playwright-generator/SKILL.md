---
name: playwright-generator
description: Generate TypeScript Playwright specs from Test Case IR using the grounded Page Objects and team coding standards. Use after parsing and grounding, before execution.
---

# Playwright generator

Produce a reviewable spec per IR. Code against Page Objects, never raw selectors.

## Output contract

- One file under `tests/`, grouped by feature; one `test()` per IR.
- Stamp each test with the IR fingerprint: run `npm run ir:hash -- <testId>` and put
  the value on the line directly above the test, e.g.
  `// @ir-hash 236044fbb163` then `test('ID-4 Logout ...', ...)`. `verify` recomputes it
  from `ir/<testId>.json`; if the Xray test changes later the spec is flagged STALE.
  Never copy a hash from another test or edit it by hand — only regenerating the
  spec from the current IR may change it.
- Title each test with its `testId`, e.g. `test('TC-002 Login fails ...')`.
- Map every IR `expected` entry to **at least one assertion**, and tag that
  assertion with a `// @covers <testId>:<expectedId>` comment on the line above
  it, e.g.:

  ```ts
  // @covers TC-002:e1
  await expect(login.errorMessage).toContainText('do not match');
  ```

  This is mandatory and machine-checked (see Gate). A spec with no assertion for
  a stated expected result, or a missing/stale `@covers` tag, is rejected.
- Prefer the **strongest** assertion the expected result allows: a value check
  (`toHaveText`, `toHaveURL`) over a state check (`toBeVisible`) over an
  existence check (`toBeAttached`). A weak assertion can pass while proving
  nothing.
- Translate `preconditions` into setup (a `beforeEach`, fixture, or opening
  steps). Drive all interaction through Page Object methods.

## Coding standards

- Use web-first assertions (`await expect(locator).to...`) — they auto-retry.
- **No** `page.waitForTimeout` / hard sleeps. Rely on auto-waiting and
  assertion retry.
- Prefer `getByRole` / `data-test` locators exposed by the Page Object.
- Keep tests independent and idempotent (fresh login per test unless a fixture
  provides `storageState`).

## Gate before running

Two gates must pass before a spec is executed — fix problems here, not in the
heal loop:

1. `npx tsc --noEmit` — the spec must type-check (and lint, if configured).
2. `npm run verify` — the assertion-coverage gate. It fails the build if any
   expected result is not covered by a tagged assertion, if a `@covers` id is
   unknown, if a test has no assertions, if a test is skipped/focused, or if the
   `@ir-hash` no longer matches the IR (STALE spec). Read
   `reports/verification.md` and fix the spec until it passes.
