# Xray → Playwright Test Migration Agent

An AI agent that **migrates manual test cases from Jira Xray (Cloud) into automated
Playwright test scripts**. It fetches the test cases, looks at the real application,
writes the Playwright tests, runs them, repairs its own mistakes within strict
limits, and reports what passed. Test cases can also come from a CSV file or a
plain-English prompt.

> **In one line:** give it Xray test cases → get back working Playwright specs, each
> assertion traceable to the Xray step result it checks.

It runs inside **VS Code GitHub Copilot** (Agent mode) as the custom agent
`test-author`.

---

## 1. Why this exists

Teams keep large suites of manual test cases in Xray. Running them by hand is slow,
and automating them by hand takes months. This agent does the repetitive migration
work. A person reviews the result before it is merged.

**Design idea:** AI is used only for the fuzzy parts (reading plain-English steps,
choosing selectors from the live page, diagnosing failures). Everything that must be
reliable is ordinary code, and fixed checks make sure the AI's output is complete.

---

## 2. Words you need to know

| Term | Meaning |
|------|---------|
| **Xray** | Jira plugin that stores test cases (steps, data, expected results). The source. |
| **Playwright** | Microsoft's browser automation tool. The target. |
| **Adapter** | Code that reads one source (Xray, CSV, prompt) and converts it to the IR. |
| **IR (Intermediate Representation)** | One standard JSON file per test case (`ir/<KEY>.json`). Everything after ingestion reads only the IR. Defined in `ir/schema.json`. |
| **Grounding** | Looking at the real app (via Playwright MCP) to find real elements instead of guessing selectors. |
| **Playwright MCP** | A browser tool for the AI. It returns a page as a text tree of roles and names (an accessibility snapshot). |
| **Page Object** | One class per page holding its elements and actions. Specs call these and never use raw selectors. |
| **Assertion** | The `expect(...)` line that decides pass or fail. |
| **`@covers` tag** | A comment above an assertion (`// @covers ID-2:ID-2-e2`) linking it to the expected result it checks. |
| **`@ir-hash` tag** | A fingerprint of the source test case, stored above each test. If the Xray test changes later, `verify` flags the spec as STALE. |
| **Gate** | A deterministic check a spec must pass before it runs or before a fix is accepted. |
| **Self-heal** | When a test fails, the agent diagnoses the cause and tries a fix, up to 3 times. |

---

## 3. Architecture

The agent is a pipeline of nine steps.

| Step | Name | Who | What it does | Key files |
|------|------|-----|--------------|-----------|
| 1 | Ingest | Code | Signs in to Xray Cloud and pulls tests by JQL | `scripts/xray.mjs` (CSV/prompt: `scripts/parse.mjs`) |
| 2 | Test case IR | Code | One standard JSON per test; every step result becomes an expected result with an id like `ID-2-e2` | `ir/*.json`, `ir/schema.json` |
| 3 | Ground the app | AI | Reads each page through Playwright MCP, writes Page Objects and a selector map | `.github/skills/app-grounding`, `app-model/<app>/` |
| 4 | Generate | AI | Writes one `test()` per IR with a tagged assertion per expected result | `.github/skills/playwright-generator`, `tests/<app>/` |
| 5 | Gates | Code | Type check and assertion-coverage/freshness check before anything runs | `tsc`, `scripts/verify.mjs` |
| 6 | Execute | Code | Runs the specs in a real browser; saves screenshot, video and trace on failure | `playwright.config.ts` |
| 7 | Analyze and heal | AI + code | Classifies each failure and applies the smallest fix (max 3 tries); a guard blocks fixes that weaken a test | `.github/skills/failure-analyzer`, `scripts/heal-guard.mjs` |
| 8 | Report | Code | Per-test status with reasons and evidence links | `scripts/report.mjs`, `reports/` |
| 9 | Human review | Person | Approves the generated tests before merge | — |

- **Editable diagram:** [`docs/architecture.drawio`](docs/architecture.drawio)
- **Presentation page:** [`docs/architecture-overview.html`](docs/architecture-overview.html)
- **Written explanation:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

### Traceability: one id from Jira to the assertion

```
Xray test ID-2, step 2 result  "The message ... is visible and the URL stays on /login"
   → ir/ID-2.json                expected id: ID-2-e2
   → tests/<app>/*.spec.ts       // @covers ID-2:ID-2-e2   await expect(...)
   → reports/verification.md     ID-2   coverage 2/2   PASS
```

---

## 4. What is in this repo

| Path | What it is |
|------|-----------|
| `.github/agents/test-author.agent.md` | The Copilot agent: pipeline order and rules |
| `.github/skills/` | Six skills the agent follows: parse, ground, generate, execute, heal, report |
| `.vscode/mcp.json` | Starts the Playwright MCP browser tool for Copilot |
| `scripts/xray.mjs` | Xray Cloud adapter (JQL → `ir/*.json`) |
| `scripts/parse.mjs` | CSV and prompt adapter |
| `scripts/verify.mjs` | Gate: every expected result has a tagged assertion; spec is not stale |
| `scripts/heal-guard.mjs` | Gate: blocks a fix that makes a test check less |
| `scripts/irhash.mjs`, `scripts/lib/irhash.mjs` | The IR fingerprint |
| `scripts/report.mjs`, `scripts/run.mjs` | Report generator and the parse → verify → test → report runner |
| `scripts/lib/ast.mjs` | Shared TypeScript-parser helpers for the gates |
| `scripts/lib/llm/` | Optional swappable LLM providers for standalone use (see section 10) |
| `ir/` | `schema.json` plus one IR file per fetched test |
| `app-model/<app>/` | One folder per app: `app.json` (baseURL), `selectors.json`, `pages/*.ts` |
| `tests/<app>/` | Generated Playwright specs |
| `unit/` | Unit tests for every deterministic script |
| `reports/`, `artifacts/` | Generated by runs (git-ignored) |
| `docs/` | Architecture diagram and write-ups |

The repo ships with one worked example app, **The Internet**
(`https://the-internet.herokuapp.com`), an open-source practice app.

---

## 5. Set it up

**You need:** Node.js 18 or newer, npm, VS Code with GitHub Copilot and Copilot Chat
(a recent version, for custom agents), and an Xray Cloud API key.

```bash
npm install
npm run install:browsers
cp .env.example .env        # then edit .env
```

**Xray credentials.** In Jira go to Apps → Xray → Settings → API Keys, create a key,
and put it in `.env` (never commit this file; it is git-ignored):

```
XRAY_CLIENT_ID=...
XRAY_CLIENT_SECRET=...
# EU / AU sites: set XRAY_BASE_URL (see .env.example). The default is the US region.
```

**Windows note.** If `npx tsc` or `npm test` reports "not recognized", the
`node_modules/.bin` launchers are missing. Run `npm install` again, or call the tools
directly: `node node_modules/typescript/bin/tsc --noEmit` and
`node node_modules/@playwright/test/cli.js test`.

---

## 6. Run it in VS Code Copilot

1. Open the `test_agent` folder in VS Code (the folder that contains `.github/`).
2. Open Copilot Chat and switch to **Agent** mode. Pick **test-author** from the
   dropdown. If it is missing, run **Chat: Configure Custom Agents** or reload the
   window.
3. Open `.vscode/mcp.json` and click **Start** on the `playwright` server. Approve its
   tools.
4. Send a prompt such as:

> Fetch the Xray tests with JQL `project = ID AND issuetype = Test` for app
> `theinternet` (https://the-internet.herokuapp.com). Run your full pipeline: create
> the app model, ground the pages with Playwright MCP, generate the specs under
> `tests/theinternet/`, run `npx tsc --noEmit` and `npm run verify`, execute the
> tests, fix failures within your 3-attempt limit using heal-guard, and give me the
> report.

Copilot asks you to approve each terminal command. To migrate a single test, use a
JQL such as `key = ID-4`.

### Creating test cases in Xray

For a team-managed Jira space, Xray needs the **Test** work type created and mapped
(Space settings → Apps → Xray Settings → Work Types). Each Xray test needs a **Manual**
test type with steps that have an Action, optional Data and an Expected Result. Use
the label `app:<app>` to name the target app, or pass `--app <app>` when fetching.

---

## 7. Run the pieces yourself

```bash
npm run fetch:xray -- --jql "project = ID AND issuetype = Test" --app theinternet [--dry-run]
npm run parse         # CSV/prompt inputs in inputs/ -> ir/*.json
npm run ir:hash -- ID-4   # print the fingerprint to stamp above a test
npm run verify        # assertion-coverage + freshness gate
npm test              # run the generated Playwright specs
npm run report        # results -> reports/report.md
npm run report:open   # interactive HTML report
npm run agent         # parse -> verify -> test -> report
npm run test:unit     # unit tests for the scripts (no browser needed)
```

`--dry-run` prints the converted tests without writing files. To run one app only:
`npx playwright test --project=theinternet`.

---

## 8. How mistakes by the AI are caught

A generated test that is **green but checks nothing** is the dangerous failure, because
re-running it never reveals the problem. So correctness is enforced by deterministic
gates and not left to the model.

| Mistake | What catches it |
|---------|-----------------|
| Syntax or type error | `tsc --noEmit` |
| Missing or empty assertion | `npm run verify`: every expected result needs a `@covers` assertion |
| Wrong or stale `@covers` id | `verify` rejects ids the IR does not define |
| Skipped or focused test | `verify` fails on `test.skip` / `test.only` |
| **Xray test changed after the spec was written** | `verify` compares `@ir-hash` with the current IR and fails with `STALE` |
| Invented or wrong selector | The test fails when run, then heal, then human review |
| A fix that weakens an assertion to go green | `scripts/heal-guard.mjs` blocks it |

### When an Xray test is edited

1. Edit the test in Jira.
2. Re-fetch it: `npm run fetch:xray -- --jql "key = ID-4" --app theinternet`
3. `npm run verify` reports `STALE` for that test.
4. The agent regenerates the spec from the updated IR with a new `@ir-hash`, then the
   gates and tests run again.

A real mismatch between a test case and the app is reported, never hidden: the agent
does not edit an expected result to make a failing test pass.

### Known limits

- The gates prove each expected result is asserted, not that the assertion means what
  the author intended. That is why human review stays.
- The agent follows the gate order from its instructions. `npm run agent` runs the
  steps in sequence and reports a failed gate at the end instead of stopping.
- Only manual Xray steps and basic Gherkin are mapped. Parameterized tests, data
  tables and preconditions with their own steps are not handled yet.
- Fetching does not delete IR files for tests removed from Xray.

---

## 9. Adding a different app

Each app is a self-contained folder that `playwright.config.ts` discovers
automatically. No code change is needed.

```
app-model/<yourapp>/
  app.json        # { "app": "<yourapp>", "baseURL": "https://..." }
  selectors.json  # map of the grounded selectors
  pages/*.ts      # Page Objects
tests/<yourapp>/
  *.spec.ts       # generated tests
```

The agent creates these folders when it grounds a new app. Fetch with
`--app <yourapp>` (or an `app:<yourapp>` label in Xray).

---

## 10. Swapping the LLM for standalone use

When you run the agent in Copilot, Copilot's model is the LLM. The scripts under
`scripts/lib/llm/` are an optional layer for standalone use, behind one interface
(`scripts/lib/llm/provider.mjs`):

```bash
LLM_PROVIDER=claude   ANTHROPIC_API_KEY=...      # Claude (Anthropic)
LLM_PROVIDER=openai   OPENAI_API_KEY=...         # ChatGPT (OpenAI)
LLM_PROVIDER=copilot  GITHUB_MODELS_TOKEN=...    # Copilot (via GitHub Models)
LLM_PROVIDER=mock                                # offline default, no key
```

Whichever model generates a spec, it must still pass `tsc`, `verify` and the heal
guard.

---

## 11. Roadmap

| Next step | Why |
|-----------|-----|
| **Migration ledger**: Xray key ↔ spec ↔ status in one table | Coverage %, and re-runs touch only new or changed tests |
| **Pilot on 30 to 50 real Xray tests** | Measure the unedited pass rate (target 80%), time per test, and how often review catches something the gates passed |
| **Open generated tests as pull requests** | A review gate before merge; optionally write status back to Xray |
| **Mutation checks** | Deliberately break the app state and confirm the test now fails |
| **Schema enforcement for the IR** | `ir/schema.json` is documented but not yet validated by a script |
| **Make a failed gate stop `npm run agent`** | Enforce the gate order in code, not only in the agent's instructions |
