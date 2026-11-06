---
name: test-executor
description: Run the generated Playwright specs and collect structured results plus failure artifacts (trace, screenshot, video). Use after generation.
---

# Test executor

Deterministic. Do not improvise — just run and collect.

## Run

- `npm test` runs all specs; `npx playwright test tests/login.spec.ts` runs one.
- Config (`playwright.config.ts`) already captures:
  - `reports/results.json` — machine-readable results (for the reporter/healer),
  - `reports/html/` — interactive HTML report,
  - `artifacts/` — trace (on first retry), screenshot + video (on failure).

## Hand off

- Pass the failing tests + their `reports/results.json` entries and artifact
  paths to `failure-analyzer`.
- Never edit specs here; execution is read-only with respect to test code.
