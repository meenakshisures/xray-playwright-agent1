---
name: app-grounding
description: Build and maintain the grounded app model (Page Objects + selector map) from the live application's accessibility tree, so generated locators reference real elements. Use before generating specs for a page not yet in the model.
---

# App grounding

The single biggest lever on "runs without edits": never let the generator invent
selectors. Every selector must come from an element that actually exists.

## Maintain the model

- Each app has its own folder: `<app>` is the app name from the IR (`app` field /
  the `--app` value). The model lives in `app-model/<app>/app.json` (baseURL),
  `app-model/<app>/selectors.json` and `app-model/<app>/pages/*.ts`. Never write
  these files at the top level of `app-model/`; create the `<app>/` folder (and
  `tests/<app>/`) if it does not exist yet.
- When an IR references a page or element not in the model, ground it:
  1. Open the live app (Playwright MCP accessibility snapshot, or
     `page.locator(...).all()` exploration in a scratch script).
  2. Capture stable handles. **Selector priority:** `getByRole` →
     `getByTestId` / `data-test` → `getByLabel` / `getByText` → CSS as a last
     resort. Never use nth-child chains or auto-generated class hashes.
  3. Add the element to `selectors.json` and expose it as a `Locator` on the
     relevant Page Object with an intent-named method.

## Drift

If a previously-grounded selector no longer resolves during a run, re-snapshot
that page and update the model — then let the generator/healer reuse it. Record
the change so the fix is reviewable.
