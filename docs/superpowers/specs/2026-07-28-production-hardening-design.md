# Job-Hunt Autopilot Production Hardening Design

**Status:** Approved
**Scope:** Public `job-hunt-autopilot` repository only
**Date:** 28 July 2026

## Goal

Make the public Google Apps Script job-search automation safe to operate for real non-paying users, while preserving its human-approval and Gmail-draft-only guardrails.

## Scope boundaries

This work covers the public repository, its `src/` Apps Script source, generated `manual-install/Code.gs` bundle, release tooling, public documentation, and a local regression-test harness.

`job-hunt-lebo` is explicitly out of scope for this change set. It will only be updated after the public repository is verified and released.

No automatic email sending will be introduced. Gmail operations must continue to create drafts only. Existing user data is not migrated or deleted by this work.

## Architecture

The existing file layout remains in place. Two focused shared modules will be added:

- `src/Runtime.gs` owns script-lock acquisition, execution deadlines, bounded batch values, and shared failure aggregation.
- `src/Validation.gs` owns HTTPS URL validation, safe digest links, external response envelopes, and Gemini result validation.

Existing workflow modules retain their responsibilities. `Loop.gs`, `Match.gs`, `Sources.gs`, and `Outreach.gs` will use the shared runtime and validation helpers rather than duplicating policy.

## Workflow state and idempotency

Scheduled functions will claim work under a `LockService` script lock. Claims will be short-lived and persisted in the CRM so a retry can distinguish incomplete work from completed work.

Opportunity processing will persist artefact references as each step completes:

1. Claim the opportunity or approval row.
2. Create or reuse the tailored CV and persist its Drive file IDs.
3. Create or reuse the cover letter and persist its Drive file IDs.
4. Create or reuse the Gmail draft when an application email exists.
5. Advance the opportunity to `drafted` only after the required artefacts are recorded.

Scoring will persist the approval record before marking the opportunity queued, with the opportunity ID as the idempotency key. Follow-ups, interview preparation, agency outreach, ingestion, and weekly KPI writes will use the same claim and reuse-or-create pattern.

Partial failures will remain visible through a failure marker and alert. They will not be silently converted into a completed state.

## Security controls

- Keep secrets in Script Properties and never log their values.
- Use provider-supported request headers instead of query-string API keys where supported.
- Keep TLS certificate validation enabled.
- Accept only HTTPS external links and validate redirect targets before fetching them.
- Permit only safe HTTPS links in HTML digest anchors.
- Validate recipient email addresses before creating drafts.
- Validate all external JSON envelopes and required job fields.
- Remove unintended maintainer identity and private-name references from the public template and generated bundle.
- Preserve the existing placeholder candidate data and sample agency data.

The existing OAuth scopes will be retained unless implementation evidence shows that a narrower scope supports the required functionality. Each scope will be mapped to an actual API call in the release verification notes.

## Reliability and runtime controls

- Gemini retries will be limited to the known unsupported-thinking-configuration case. Other HTTP 400 responses will fail immediately.
- Gemini JSON will be validated for required fields and score range before CRM writes.
- Per-source malformed records will be skipped individually and included in an aggregate failure report.
- Every scheduled entry point will alert on failure and rethrow after releasing its lock.
- All expensive loops will have hard caps and deadline checks.
- Batch configuration values will be clamped to safe maximums.
- Work will resume from persisted CRM state on the next trigger run.

## Testing strategy

Because Apps Script services are unavailable in local Node execution, the repository will gain a small dependency-free test harness for pure helpers and service seams. Tests will cover:

- URL scheme and redirect validation.
- HTML link safety.
- Gemini retry classification and response validation.
- Malformed source responses.
- Batch clamping and deadline decisions.
- Duplicate claims and idempotent artefact reuse.
- Failure aggregation and alert decisions.
- Bundle source coverage and generated-file consistency.

Each bug fix will follow a red-green cycle: add a failing regression test, verify the expected failure, implement the smallest fix, and rerun the complete local suite.

Authenticated Apps Script smoke tests are mandatory before live deployment. They will run against a disposable test Sheet, Drive folder, Gmail account, and test API keys, and will verify that the system creates drafts without sending messages. If the required credentials or test resources are unavailable, live deployment is blocked.

## Release gate

The release is ready only when:

- No Critical findings remain.
- Important findings are fixed or explicitly documented as accepted.
- The local regression suite passes.
- Every `.gs` file and the generated bundle pass syntax checks.
- The bundle is regenerated from `src/`.
- The versioned ZIP is built from the committed tree and inspected.
- Public PII and real secrets are absent from tracked files and the ZIP.
- The release commit and verification evidence are recorded.
