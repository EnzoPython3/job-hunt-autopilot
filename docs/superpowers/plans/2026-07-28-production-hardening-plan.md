# Job-Hunt Autopilot Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the public Google Apps Script job-search automation against secret leakage, unsafe external data, duplicate processing, silent failures, malformed responses, and execution-time overruns before any live deployment.

**Architecture:** Preserve the current Apps Script file layout and add small shared runtime and validation modules. Scheduled workflows will use script locks plus persisted claim and artefact state, while local Node tests exercise pure helpers and service seams. The generated manual bundle and release ZIP remain derived release artefacts, never independent sources.

**Tech Stack:** Google Apps Script V8, `LockService`, `PropertiesService`, Sheets/Drive/Docs/Gmail services, Gemini REST API, Node built-in `node:test`, Bash release tooling, clasp for authenticated smoke tests.

---

## Scope and non-negotiable release gates

- Target only `/Users/enzosnyman/projects/job-hunt-autopilot`.
- Do not modify `/Users/enzosnyman/projects/job-hunt-lebo`.
- Do not add any automatic send operation. Gmail must remain draft-only.
- Do not deploy live until local tests, syntax checks, bundle checks, ZIP inspection, and authenticated smoke tests have passed. If authenticated smoke tests are unavailable, live deployment is blocked.
- Do not commit credentials, real candidate data, live Sheet IDs, live Drive IDs, or live Gmail addresses.
- Use a feature branch or isolated worktree for implementation. The existing `main` branch contains the approved design commit `518a5fb`.

## Files and responsibilities

Create:

- `src/Runtime.gs`: shared lock, deadline, bounded batch, claim, and failure helpers used by scheduled workflows.
- `src/Validation.gs`: safe URL, email, external response, and Gemini result validation.
- `test/helpers/load-gs.mjs`: deterministic loader for pure `.gs` modules in Node tests.
- `test/validation.test.mjs`: security and response-shape regression tests.
- `test/runtime.test.mjs`: batch, claim, deadline, and idempotency regression tests.
- `test/gemini.test.mjs`: retry classification and Gemini response regression tests.
- `test/sources.test.mjs`: source envelope and malformed-record regression tests.
- `test/bundle.test.mjs`: source-to-bundle coverage checks.
- `package.json`: only a `test` script using Node's built-in test runner; no runtime npm dependency.

Modify:

- `src/Config.gs`: centralise supported property names and clamp runtime settings.
- `src/Gemini.gs`: header authentication, narrow retry classification, bounded errors, and result validation.
- `src/Sources.gs`: safe URL handling, TLS validation, response validation, malformed-row skipping, and deadline checks.
- `src/Crm.gs`: schema fields and helpers for idempotent records and processing markers.
- `src/Match.gs`: claim sourced rows and create approval records idempotently before advancing status.
- `src/Tailor.gs`: deterministic artefact lookup and persisted IDs.
- `src/Outreach.gs`: validated recipients and draft reuse keys.
- `src/Loop.gs`: lock/deadline wrappers, resumable batches, failure aggregation, and safe partial recovery.
- `src/Diagnostics.gs`: sanitised diagnostics and bounded maintenance work.
- `src/Digest.gs`: safe HTTPS links and bounded digest output.
- `src/Report.gs`: locked idempotent KPI update.
- `src/Triggers.gs`: ensure trigger installation remains deterministic and documents the runtime entry points.
- `src/Alerts.gs`: sanitised failure messages without secrets or unsafe raw response bodies.
- `src/Onboarding.gs`: use the central property key map and preserve secret-cell clearing.
- `tools/bundle.sh`: include every source file exactly once, including new shared modules.
- `scripts/make-release.sh`: verify clean committed source and release metadata before building.
- `docs/SETUP.md`, `docs/RUNBOOK.md`, `docs/RELEASES.md`, `README.md`, `QUICKSTART.md`: document safe setup, recovery, test gates, and release provenance.
- `manual-install/Code.gs`: regenerate from `src/`, never hand-edit.

## Task 0: Isolate the implementation branch

**Files:** Git worktree only.

- [ ] Create an isolated worktree and branch from `main` named `feat/production-hardening`.
- [ ] Confirm the worktree starts clean and contains commit `518a5fb`.

Run:

```bash
git worktree add ../job-hunt-autopilot-production-hardening -b feat/production-hardening main
git -C ../job-hunt-autopilot-production-hardening status --short --branch
git -C ../job-hunt-autopilot-production-hardening rev-parse --short HEAD
```

Expected: a clean feature branch at `518a5fb`.

## Task 1: Add the dependency-free local test harness

**Files:**

- Create: `package.json`
- Create: `test/helpers/load-gs.mjs`
- Create: `test/bundle.test.mjs`

- [ ] Add `package.json` with only this test command:

```json
{
  "private": true,
  "scripts": {
    "test": "node --test test/*.test.mjs"
  }
}
```

- [ ] Add a loader that reads a `.gs` file, evaluates it in a Node `vm` context, and returns named globals. The loader must accept injected Apps Script service stubs and must not read environment secrets.
- [ ] Add a bundle test that reads `tools/bundle.sh`, lists `src/*.gs`, parses the `ORDER` array, and fails if any source file is missing or repeated.
- [ ] Run `npm test` and confirm the bundle test fails only if the implementation is intentionally incomplete. Commit the harness once it passes.

Run:

```bash
npm test
```

Expected: the test runner starts with no network calls and reports the bundle coverage test passing.

## Task 2: Add validation helpers with red-green tests

**Files:**

- Create: `src/Validation.gs`
- Create: `test/validation.test.mjs`

- [ ] Write failing tests for:
  - accepting `https://` URLs;
  - rejecting `http:`, `javascript:`, `data:`, malformed, empty, and credential-bearing URLs;
  - resolving only HTTPS redirect targets;
  - accepting normal recipient email addresses and rejecting control characters, whitespace injection, and malformed addresses;
  - escaping HTML text while allowing only a validated HTTPS `href`;
  - recognising valid Gemini candidate envelopes and rejecting missing candidates, missing text parts, and unexpected JSON types.
- [ ] Run `npm test -- --test-name-pattern='validation'` and verify the new tests fail for the missing helpers.
- [ ] Implement `Validation.safeHttpsUrl(value)`, `Validation.safeHref(value)`, `Validation.isEmail(value)`, `Validation.requireArray(value, label)`, `Validation.requireObject(value, label)`, and `Validation.validateGeminiTextResponse(json)`.
- [ ] Re-run the validation tests and the full suite. Commit the helper and tests.

The helper contract must be deterministic and free of Apps Script service calls so it remains locally testable.

## Task 3: Harden Gemini authentication, retrying, and schema validation

**Files:**

- Modify: `src/Gemini.gs`
- Modify: `src/Match.gs`
- Create or extend: `test/gemini.test.mjs`

- [ ] Write failing tests proving that a 400 caused by unsupported `thinkingConfig` retries once without that block, while authentication, model, schema, and malformed-request 400 responses do not retry.
- [ ] Write failing tests proving that 429 and 5xx responses honour the finite retry count and that a successful response with no text fails validation.
- [ ] Write a failing scoring test proving `fit_score` outside 0 to 100, missing `track`, or missing `rationale` is rejected before any CRM update.
- [ ] Run the focused tests and confirm they fail for the current broad retry and loose parsing behaviour.
- [ ] Move Gemini authentication to the provider-supported `x-goog-api-key` request header and ensure error text never includes the key, complete request URL, or full response body.
- [ ] Make retry classification inspect the parsed error reason or a narrowly defined unsupported-field response. Keep the total request count finite.
- [ ] Validate JSON scoring results before `Match.scoreQueue()` writes them.
- [ ] Re-run focused and full tests. Commit the Gemini hardening.

## Task 4: Harden source fetching and external data handling

**Files:**

- Modify: `src/Sources.gs`
- Modify: `src/Diagnostics.gs`
- Extend: `test/validation.test.mjs`
- Create or extend: `test/sources.test.mjs`

- [ ] Write failing tests for null, object, and missing-array API envelopes; malformed individual job rows; unsafe URLs; and redirects to non-HTTPS targets.
- [ ] Run the focused source tests and confirm the current assumptions fail.
- [ ] Validate every fetched job URL before resolving or storing it. Require HTTPS and keep `validateHttpsCertificates` enabled.
- [ ] Validate redirect targets returned by headers and meta refresh before following them.
- [ ] Make Adzuna, JSearch, Greenhouse, Lever, Ashby, and Workable adapters return empty or skip one malformed record instead of aborting the full source batch.
- [ ] Keep API keys out of logs and diagnostics. Diagnostics may report set/unset and response status, never keys, full URLs containing keys, or unbounded response bodies.
- [ ] Add a bounded failure accumulator so `Sources.ingest()` reports source failures to its trigger rather than silently succeeding with zero rows.
- [ ] Re-run focused and full tests. Commit the source hardening.

## Task 5: Centralise configuration and enforce runtime limits

**Files:**

- Modify: `src/Config.gs`
- Modify: `src/Onboarding.gs`
- Modify: `src/Setup.gs`
- Modify: `test/runtime.test.mjs`

- [ ] Write failing tests for safe maximums on `CHUNK_SIZE`, `DAILY_SOURCE_CAP`, `AGENCY_DRAFTS_PER_RUN`, and maintenance checks.
- [ ] Write a failing test proving `DAILY_APPROVAL_N` limits the number of new approval rows created in one scoring run.
- [ ] Run focused tests and verify the current unbounded tunable values fail.
- [ ] Add all supported property names to `Config.KEYS`, including alert and filter properties, while retaining the documented Adzuna compatibility alias.
- [ ] Clamp numeric tunables to explicit safe maxima and reject negative or non-numeric values.
- [ ] Enforce `DAILY_APPROVAL_N` in scoring and document that the limit applies to new approval rows created by the scoring workflow.
- [ ] Re-run focused and full tests. Commit configuration and limit handling.

## Task 6: Add lock, claim, and failure primitives

**Files:**

- Create: `src/Runtime.gs`
- Modify: `src/Crm.gs`
- Create or extend: `test/runtime.test.mjs`

- [ ] Write failing tests for:
  - refusing a second concurrent claim for the same logical key;
  - reclaiming an expired claim;
  - releasing claims in a `finally` path;
  - stopping work at a deadline;
  - aggregating item failures while preserving the trigger-level failure signal.
- [ ] Run focused tests and verify the current code has no claim or deadline primitives.
- [ ] Implement `Runtime.withScriptLock(name, waitMs, fn)`, `Runtime.deadlineMs(limitMs)`, `Runtime.shouldStop(deadline)`, `Runtime.boundedBatch(value, fallback, maximum)`, and `Runtime.failure(name, error)`.
- [ ] Add CRM headers and helpers for `processing_state`, `processing_key`, `processing_started_at`, `cv_file_id`, `cover_file_id`, `draft_id`, and `failure_message` where those fields are needed. Preserve compatibility with existing rows by treating missing cells as empty.
- [ ] Implement claim and release helpers under the script lock. Claims must be keyed by the stable opportunity or contact ID, not a mutable row number.
- [ ] Re-run focused and full tests. Commit the runtime primitives.

## Task 7: Make scoring and approval creation idempotent

**Files:**

- Modify: `src/Match.gs`
- Modify: `src/Loop.gs`
- Modify: `src/Crm.gs`
- Extend: `test/runtime.test.mjs`

- [ ] Write a failing test proving two scoring workers cannot process the same sourced opportunity concurrently.
- [ ] Write a failing test proving an existing approval row for an opportunity is reused rather than appended twice.
- [ ] Write a failing test proving an approval append failure does not leave the opportunity permanently queued without an approval record.
- [ ] Run the focused tests and confirm failure against the current status-first implementation.
- [ ] Claim each sourced opportunity before calling Gemini.
- [ ] Validate the score, upsert the approval row by opportunity ID, verify the approval row exists, then advance the opportunity status.
- [ ] Record a visible failure state when scoring or approval creation fails, leaving the row eligible for safe retry.
- [ ] Re-run focused and full tests. Commit the scoring workflow.

## Task 8: Make CV, cover, outreach, follow-up, interview, and agency work resumable

**Files:**

- Modify: `src/Tailor.gs`
- Modify: `src/Outreach.gs`
- Modify: `src/Loop.gs`
- Modify: `src/InterviewPrep.gs`
- Modify: `test/runtime.test.mjs`

- [ ] Write failing tests for reusing stored CV, cover, interview document, and Gmail draft IDs.
- [ ] Write failing tests proving a failure after CV creation does not create a second CV on retry.
- [ ] Write failing tests proving follow-up markers are written only after draft creation and prevent a second draft.
- [ ] Run the focused tests and verify current duplicate-producing behaviour.
- [ ] Add deterministic operation keys based on opportunity ID and operation name.
- [ ] Persist each artefact ID immediately after creation and look it up before creating a new artefact.
- [ ] Validate `contact_email` before draft creation and preserve the draft-only guardrail.
- [ ] Add hard deadlines and maximum counts to follow-ups, interview preparation, and agency outreach.
- [ ] Aggregate per-item failures and alert once per trigger run while leaving failed rows recoverable.
- [ ] Re-run focused and full tests. Commit resumable workflow processing.

## Task 9: Harden ingestion idempotency, digest links, and weekly reporting

**Files:**

- Modify: `src/Sources.gs`
- Modify: `src/Digest.gs`
- Modify: `src/Report.gs`
- Extend: `test/sources.test.mjs`
- Extend: `test/validation.test.mjs`

- [ ] Write a failing test proving two ingestion runs cannot append the same stable job ID.
- [ ] Write a failing test proving a digest omits unsafe or non-HTTPS links.
- [ ] Write a failing test proving concurrent weekly-report runs update one KPI row rather than append duplicates.
- [ ] Run focused tests and confirm current behaviour fails these cases.
- [ ] Wrap ingestion in the shared lock and recheck the stable ID immediately before append.
- [ ] Use the safe href helper in every digest anchor and retain escaped plain-text content.
- [ ] Lock KPI read-update-append logic and identify the weekly row by spreadsheet timezone.
- [ ] Add a deadline to source resolution and maintenance loops that checks before every network request.
- [ ] Re-run focused and full tests. Commit ingestion, digest, and report hardening.

## Task 10: Alert all trigger failures and sanitise diagnostics

**Files:**

- Modify: `src/Loop.gs`
- Modify: `src/Diagnostics.gs`
- Modify: `src/SheetUi.gs`
- Modify: `src/Alerts.gs`
- Extend: `test/runtime.test.mjs`

- [ ] Write failing tests or seam tests proving each scheduled entry point reports a failure after an item-level error.
- [ ] Write a failing test proving alert output strips API keys, full request URLs, and unbounded response bodies.
- [ ] Run focused tests and confirm swallowed errors remain.
- [ ] Wrap every scheduled function with the shared lock and `try/catch/finally` pattern.
- [ ] Convert per-item catches into collected failures that call `Alerts.notify()` and preserve a retryable CRM state.
- [ ] Add the same failure visibility to `draftAgencyOutreach()` and the installable sheet edit path where an actionable alert destination exists.
- [ ] Keep alert delivery failure non-recursive and log only a sanitised alert-delivery error.
- [ ] Re-run focused and full tests. Commit alert and diagnostic handling.

## Task 11: Remove public PII and regenerate the bundle

**Files:**

- Modify: `LICENSE`
- Modify: `src/Alerts.gs`
- Modify: `docs/RELEASES.md`
- Modify: `manual-install/Code.gs`
- Modify: `tools/bundle.sh`
- Extend: `test/bundle.test.mjs`

- [ ] Write a failing release-content scan for maintainer names, personal LinkedIn URLs, private-name lists, live-looking email addresses, and API-key patterns.
- [ ] Run the scan and confirm it identifies the current public identity references.
- [ ] Replace personal support links with neutral project issue and documentation links. Preserve only the attribution required by the chosen licence policy.
- [ ] Remove private-name grep patterns from public release documentation.
- [ ] Add `Runtime.gs` and `Validation.gs` to the bundle order exactly once.
- [ ] Regenerate `manual-install/Code.gs` with `bash tools/bundle.sh`.
- [ ] Run syntax checks over every source file and the regenerated bundle.
- [ ] Re-run the release-content scan and commit the sanitised public artefacts.

## Task 12: Documentation and release verification tooling

**Files:**

- Modify: `scripts/make-release.sh`
- Modify: `docs/SETUP.md`
- Modify: `docs/RUNBOOK.md`
- Modify: `docs/RELEASES.md`
- Modify: `README.md`
- Modify: `QUICKSTART.md`

- [ ] Add release-script checks that require a clean committed tree, confirm the bundle is current, write the source commit into `VERSION.txt`, and fail if forbidden secret or PII patterns are present.
- [ ] Document the recovery states, retry behaviour, lock behaviour, draft-only guarantee, and local test command.
- [ ] Document the authenticated smoke-test procedure using a disposable Apps Script project and test resources.
- [ ] Document that live deployment is blocked until local tests and smoke tests are complete.
- [ ] Run the release script in a temporary output directory or with a new explicit version and inspect the ZIP listing and extracted content.
- [ ] Commit tooling and documentation.

## Task 13: Full pre-deployment verification

**Files:** Verification outputs only, plus any fixes required by failed checks.

- [ ] Run the complete local suite:

```bash
npm test
```

Expected: zero failed tests and zero uncaught test errors.

- [ ] Run syntax checks:

```bash
for f in src/*.gs manual-install/Code.gs; do cp "$f" /tmp/job-hunt-syntax.js && node --check /tmp/job-hunt-syntax.js; done
```

Expected: every file exits with status 0.

- [ ] Run bundle consistency and forbidden-content scans:

```bash
bash tools/bundle.sh
npm test -- --test-name-pattern='bundle|release'
```

Expected: bundle generation succeeds and all source files are represented exactly once.

- [ ] Run authenticated Apps Script smoke tests only after all local checks pass. Verify setup, schema creation, one source fetch, one score, one approval, one CV/cover generation, one Gmail draft, retry recovery, and that the Gmail sent count does not increase. If this test cannot run, stop and do not deploy live.
- [ ] Run `git diff --check`, inspect `git status`, inspect the generated ZIP with `unzip -l`, and scan extracted contents for secrets and unintended PII.
- [ ] Record test commands, counts, smoke-test limitations, commit SHA, bundle checksum, and ZIP checksum in the release notes.
- [ ] Do not deploy live if any required verification fails.

## Task 14: Final review and release handoff

**Files:** Git history, release ZIP, release documentation.

- [ ] Dispatch a final spec-compliance review against the approved design and this plan.
- [ ] Dispatch a final code-quality review covering Apps Script runtime behaviour, lock release, state migration safety, and draft-only behaviour.
- [ ] Fix and re-test every review finding before release.
- [ ] Build the final versioned ZIP only from the committed tree.
- [ ] Present the verified branch, commit SHA, release ZIP path, Drive upload status, local test result, and live smoke-test result.
- [ ] Deploy live only after the user confirms the final verification report.
