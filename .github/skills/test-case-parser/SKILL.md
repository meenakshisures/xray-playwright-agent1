---
name: test-case-parser
description: Normalize free-text prompts and CSV test cases into the canonical Test Case IR (ir/schema.json). Use before generating any Playwright code.
---

# Test case parser

Turn any input into one validated IR object per test case. The deterministic
`scripts/parse.mjs` handles CSV and stubs prompts; you finish the LLM part.

## Steps

1. Run `npm run parse`. CSV rows become complete IR files; prompt lines become
   stubs with `needsLlmNormalization: true`.
2. For each stub (and any CSV IR with `needsClarification: true`):
   - Infer `preconditions`, decompose `steps` into discrete user actions, and
     extract `testData` as key/value pairs.
   - Rewrite `expected` as one or more **assertable** statements. Each must be
     checkable with a Playwright assertion (visible text, URL, count, state).
   - Set `needsLlmNormalization`/`needsClarification` back to false once done.
3. **Ambiguity gate.** If a step or expected result cannot be made assertable
   without guessing (e.g. "verify it works"), set `needsClarification: true`,
   add specific `clarificationQuestions`, and ask the user before proceeding.
   Do not fabricate expected results.

## Validate

Every IR must conform to `ir/schema.json`: required `testId`, `title`, `source`,
non-empty `steps`, and non-empty `expected`.
