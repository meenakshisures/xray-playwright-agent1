---
name: report-generator
description: Aggregate a run into a per-test-case report (Markdown + Playwright HTML) with status, reasons, and artifact links. Use as the final step.
---

# Report generator

Deterministic. One status per test case, with the reason attached — nothing
silently skipped.

## Run

- `npm run report` reads `reports/results.json` and writes `reports/report.md`:
  pass rate, a per-case status table, and a failure-detail section with reasons
  and artifact paths.
- `npm run report:open` opens the Playwright HTML report (traces, steps, video).

## Summarize for the user

State plainly:
- `X/Y passed (Z%)` against the agreed target,
- each failure with its classified reason,
- anything the agent flagged as a real app bug (not an automation defect),
- any test left unresolved after the retry budget.
