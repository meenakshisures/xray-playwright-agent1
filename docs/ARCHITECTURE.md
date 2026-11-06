# Architecture

AI agent that **migrates Xray (Jira) test cases into Playwright tests** — and can
also create new tests from free-text prompts or CSV. It reads a test case,
grounds in the real app (via Playwright MCP), generates a self-correcting
Playwright spec, and records the migration for traceability.

- **Editable diagram:** [`architecture.drawio`](./architecture.drawio) — open at
  [app.diagrams.net](https://app.diagrams.net) (File → Open) or with the
  **Draw.io Integration** extension in VS Code.
- **Rendered overview:** https://claude.ai/artifact/RkKLSnjLqg4WaXhnCTMTwk

## Design principles

The naïve approach — "LLM reads a test case and emits Playwright, retry on
failure" — plateaus near 40–50% usable scripts because the model hallucinates
selectors and has no model of the app. Four structural choices fix that:

1. **LLM only at the fuzzy edges.** Language understanding, selector choice, and
   failure diagnosis use the model; parsing, execution, retry control, and
   reporting are plain deterministic code.
2. **An Intermediate Representation (IR).** Every input normalizes to one
   canonical schema ([`../ir/schema.json`](../ir/schema.json)) before any code is
   generated. A new input source is just a new adapter — nothing downstream
   changes. This is the extensibility seam.
3. **Grounding in the real DOM.** Snapshot the live accessibility tree and build
   Page Objects from elements that actually exist. This is the biggest lever on
   the "runs without edits" rate.
4. **Diagnosing self-heal, not green-chasing.** Failures are classified before
   they are fixed, within a hard retry budget. A real app bug stops and is
   reported — the agent never weakens an assertion to force a pass.

## The pipeline

Data flows top to bottom. Purple = LLM-driven, teal/green = deterministic,
yellow = human gate, blue = traceability.

| Layer | Name | Responsibility | Kind |
|------:|------|----------------|------|
| 1 | Ingestion & Adapters | `XrayAdapter` / `CsvAdapter` / `PromptAdapter` → raw intent | deterministic |
| 2 | Normalization → IR | Canonical schema (+ Xray key, steps, preconditions); clarification gate | LLM |
| 3 | App Grounding (Playwright MCP) | live a11y snapshot + codebase → Page Objects + selector map | det + LLM |
| 4 | Script Generation | TS spec; ≥1 `expect()` per expected result; `tsc` gate | LLM |
| 5 | Execution | `playwright test`; trace / screenshot / video | deterministic |
| 6 | Analysis & Self-heal | Classify failure → fix the cause; retry ≤ 3 | LLM |
| 7 | Human Review Gate | Reviewer approves the generated spec (PR) before merge | human |
| 8 | Reporting & Migration Dashboard | Per-case status + reason; throughput; coverage; nothing skipped | deterministic |

### Migration backbone — the ledger

The feature that makes this a *migration* tool rather than a one-off generator is
the **Migration Ledger**: a record mapping every `Xray key ↔ IR ↔ spec path ↔ run
status ↔ migration state` (migrated / needs-review / failed / blocked). It gives
three things scale demands:

- **Traceability** — every Playwright spec points back to its Xray test (audit + coverage %).
- **Idempotent batch runs** — re-running the migration only touches new or failed cases.
- **Throughput metrics** — how many migrated, how many need review, unedited pass rate.

Optionally, the reporter **writes back** to Xray (automation link + status) so Xray
stays the source of truth.

### Self-heal loop (Layer 6)

```
Execute → capture (error, DOM, trace) → classify → patch the real cause → re-run
```

Failure taxonomy and the correct response to each:

| Class | Signal | Fix |
|-------|--------|-----|
| locator | not found / strict-mode violation | re-ground; update Page Object selector |
| timing | ready-state race; passes on retry | web-first assertion on the right state (never `waitForTimeout`) |
| assertion | action ok, expected value wrong | re-read the IR `expected` |
| data / env | auth expired, data missing, wrong baseURL | fix fixtures / `.env` |
| app bug | app genuinely violates the expected result | **STOP and report** — do not alter the assertion |

Guard: **max 3 attempts per test**, then report as unresolved.

## Supporting structures

- **Persistence & registry:** IR store (versioned), generated spec repo (git),
  App Model Registry (Page Objects + selectors per app), run history / flakiness,
  Fix Memory (RAG of past patches to heal faster over time), **Migration Ledger**
  (the Xray ↔ spec traceability record described above).
- **Cross-cutting foundation:** orchestrator / state machine, retry & token
  budgets, config & secrets (`.env`, Playwright `storageState`), observability,
  CI/CD, human-in-the-loop gates.

## Verification & trust (how LLM mistakes are caught)

A passing test is necessary but **not sufficient** — the dangerous LLM failure is
a spec that is green while asserting the wrong thing, or nothing. Execution alone
cannot catch that, so correctness is enforced by deterministic gates, not by
trusting the model:

- **Assertion-coverage gate** (`scripts/verify.mjs`, AST-based). Every IR
  `expected` entry must be covered by an assertion carrying a
  `// @covers <testId>:<id>` tag. Fails on: no assertion, missing coverage, stale
  `@covers` id, non-assertable IR, and skipped/focused tests.
- **Self-heal guard** (`scripts/heal-guard.mjs`). Diffs a spec before/after a heal
  and **blocks** any change that removes an assertion, downgrades a matcher
  (value → state → existence strength order), flips a negation, drops the
  assertion count, or adds `skip()`/`fixme()`. Enforces "never green-chase" as
  code, not just a prompt rule.
- **Static gate**: `tsc --noEmit` (and lint).
- **Human review gate (L7)**: the backstop for semantic equivalence, which no
  automated check can fully prove.

Planned (Phase 2): **mutation / negative control** — perturb the precondition and
confirm the test now *fails*; a test that still passes is vacuous. This is the
strongest automated defense against "green but checks nothing."

Every deterministic rule above is unit-tested under `unit/` (`npm run test:unit`),
alongside the parser, AST analysis, reporter, and provider factory.

## Swappable LLM provider

The model behind the fuzzy stages (normalize, generate, analyze) sits behind one
interface, `scripts/lib/llm/provider.mjs`:

```
provider.complete({ system, prompt }) -> { text, raw }
```

Adapters exist for **Claude** (Anthropic), **ChatGPT** (OpenAI) and **Copilot**
(via GitHub Models, OpenAI-compatible), plus a **mock** for offline/tests;
selection is the `LLM_PROVIDER` env var. Because every model's output still has
to pass the deterministic gates above, the provider is swappable *without*
changing the quality bar.

## Generic across apps

The pipeline is app-agnostic. Each app is a self-contained module —
`app-model/<app>/{app.json, selectors.json, pages/}` with tests under
`tests/<app>/` — and `playwright.config.ts` **auto-discovers** them (one project
per app, each with its own `baseURL`). Adding an app is "drop a folder," no config
edit. The repo ships one worked example (The Internet) to prove it.

## Mapping to this repo

| Layer | Skill (`.github/skills/`) | Deterministic code | Artifacts |
|-------|---------------------------|--------------------|-----------|
| 1–2 | `test-case-parser` (+ `XrayAdapter`, planned) | `scripts/parse.mjs` | `ir/*.json` |
| 3 | `app-grounding` | — | `app-model/` |
| 4 | `playwright-generator` | `tsc` gate | `tests/*.spec.ts` |
| 5 | `test-executor` | `playwright.config.ts` | `reports/results.json`, `artifacts/` |
| 6 | `failure-analyzer` | — | (edits to specs / model) |
| 7 | — (human / PR review) | — | approved PR |
| 8 | `report-generator` | `scripts/report.mjs` | `reports/report.md`, HTML, traceability |

The [`test-author`](../.github/agents/test-author.agent.md) subagent orchestrates these
layers; `scripts/run.mjs` is the deterministic backbone they hang off. The Xray
adapter and Migration Ledger are the main Phase-2 additions.

## Phased delivery

- **Phase 1 (POC, this repo):** prompt + CSV → IR, static grounding on one app,
  generate + execute + Markdown report, self-heal for locator/timing. Target:
  80% unedited pass on the pilot set.
- **Phase 2 (Beta — the migration core):** `XrayAdapter` (GraphQL/REST) + the
  Migration Ledger for traceability and idempotent batch runs; live a11y grounding
  via Playwright MCP; Fix Memory (RAG); HTML report + CI; PR-based review gate.
- **Phase 3 (Scale):** multi-app registry, selector-drift auto-refresh, migration
  dashboard, write-back to Xray, pluggable generator backends (API, mobile).
