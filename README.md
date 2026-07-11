# Job-Hunt Autopilot

An **assisted** job-application loop for one candidate, built on **Google Apps Script** +
**Google Sheets** + **Gemini**. It sources jobs, scores fit, tailors a CV + cover letter,
drafts outreach, and tracks everything in a Sheet - but **a human approves before anything
goes out**. Nothing is auto-sent.

Goal: help book **2-5 interviews/week**.

> **New here? Start with [QUICKSTART.md](QUICKSTART.md)** - a plain-language setup guide
> (no coding needed). This README is the technical overview.

## How it works
1. `dailySource()` pulls jobs from **JSearch** (via RapidAPI - aggregates Google for Jobs,
   so it covers Indeed/LinkedIn/Glassdoor/PNet and more), **Adzuna** (official API), and
   optional public **ATS feeds** (Greenhouse/Lever/Ashby/Workable). Official APIs only, no
   scraping. Every new link is followed and validated on ingest; dead links are dropped.
2. `scoreQueue()` asks **Gemini** to score each job's fit (0-100) and routes strong matches
   to the **Approvals** tab.
3. You tick **Approve** on rows in the Approvals tab.
4. `prepApprovedBatch()` tailors a CV + cover letter (PDF in Drive) and, where a contact
   email exists, creates a **Gmail draft** with the CV attached. Portal-only roles are
   flagged "submit manually".
5. You review the Gmail drafts, send them, and submit portal roles by hand.
6. `weeklyReport()` drafts a funnel summary vs the 2-5 interview target.

## What it actually connects to (be honest about this)
- **2 job APIs by default:** JSearch (RapidAPI) + Adzuna. Both are aggregators - the wide
  "LinkedIn/Indeed/Glassdoor/PNet" reach comes *through* JSearch (Google for Jobs), not
  from separate per-board integrations.
- **4 more integrations exist but are off by default:** Greenhouse/Lever/Ashby/Workable
  ATS feeds. They only fire if you add specific company board slugs in `Config.gs`.
- **Gemini** does the fit-scoring and the CV/cover tailoring (it is not a job source).

## Filters you control (Setup tab / Script Properties)
- **Location** - `ALLOWED_REGIONS` keeps only jobs in those areas; `ALLOW_REMOTE` keeps
  remote roles from anywhere. Applied at ingest, so off-location jobs never enter the sheet.
- **Excluded boards** - `EXCLUDED_DOMAINS` (e.g. `careers24`) hard-drops jobs from boards you
  don't want, even ones hidden behind an Adzuna redirect.
- **Portal tailoring** - `TAILOR_FOR_PORTALS` (default on) writes a tailored CV + cover for
  every approved job; set it off to tailor only email applications and apply to portals by hand.

## Guardrails (by design)
- **Assisted only** - no per-item auto-submit, no auto-send. Everything is a draft.
- **No fabrication** - prompts forbid inventing metrics/employers/dates; salary is never printed.
- **Compliant sourcing** - official APIs (JSearch/RapidAPI, Adzuna) + public ATS feeds only;
  no scraping; portals are human-submitted.
- **Secrets** live in Script Properties, never in git.

## Repo map
- `QUICKSTART.md` - non-technical setup guide (read this first).
- `manual-install/Code.gs` - all of `src/` bundled into one file for copy-paste install
  (no terminal needed). Generated from `src/`; `src/` is the source of truth.
- `src/` - the Apps Script project (clasp `rootDir`).
  - `Config.gs` keys/knobs/candidate profile - `Gemini.gs` LLM wrapper - `Prompts.gs` prompt templates
  - `Crm.gs` Sheet CRM - `Sources.gs` job ingestion - `Match.gs` scoring - `Tailor.gs` CV/cover - `Outreach.gs` Gmail drafts
  - `Loop.gs` trigger entry points - `Triggers.gs` scheduler - `Report.gs` weekly summary - `Setup.gs` one-time bootstrap
- `data/agencies.sample.csv` - starter SA recruitment-agency / BPO list (fill in emails).
- `docs/` - `SETUP.md` (clasp path), `RUNBOOK.md` (daily use + tuning), `SHEET_SCHEMA.md` (CRM columns), `RELEASES.md` (maintainer-only: how to cut a versioned share zip).
- `cv/TEMPLATE-CV.md` - skeleton master CV; turn it into a Google Doc with a `{{SUMMARY}}`
  token (see QUICKSTART step on the CV).

## Get started
- **Non-technical:** double-click **`START-HERE.html`** (opens in any browser, no internet
  needed) for the friendly step-by-step. Same content as [QUICKSTART.md](QUICKSTART.md).
- **Technical (clasp):** [docs/SETUP.md](docs/SETUP.md) - prerequisites, project structure,
  `clasp` push `src/`, set Script Properties, run `setupProject()`, then `installTriggers()`.
  Rebuild the paste bundle after editing `src/` with `bash tools/bundle.sh`.

## Licence
[MIT](LICENSE). Use it, fork it, adapt it. Contributions welcome.
