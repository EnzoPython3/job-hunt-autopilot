# CRM sheet schema

One Google Sheet ("Job-Hunt CRM"), created by `setupProject()`. Tabs and columns are owned by `src/Crm.gs` (`HEADERS`). Row 1 is a frozen header.

## Opportunities (the master pipeline - one row per job)
`id, source, company, role, location, mode, url, contact_email, posted_date, fit_score, track, rationale, status, cv_pdf_url, cover_url, outreach_draft_url, applied_date, response, interview_date, notes, created_at, updated_at`

- `id` - stable content hash (dedup key).
- `status` - see the pipeline below.
- `cv_pdf_url` / `cover_url` - links to the tailored PDFs in Drive.
- `outreach_draft_url` - `gmail-draft:<id>` when an email draft was created.

## Approvals (the human review queue)
`id, company, role, url, fit_score, track, rationale, cv_pdf_url, cover_url, outreach_draft_url, channel, decision, edited_notes`

- You edit `decision`: type `Approve` or `Skip`.
- `channel` - `email` (has a contact address) or `portal` (submit manually).

## Contacts (posted contacts + recruitment agencies)
`id, name, email, type, company, focus, last_contacted, notes`

- `type` - `agency` rows are used by `draftAgencyOutreach`.
- `last_contacted` - set automatically once a draft is created (prevents re-contacting).

## KPIs (weekly rollup)
`week_start, sourced, scored, queued, approved, submitted, sent, responses, interviews, notes`

Written automatically by `weeklyReport()` (Mon 07:00): one row per week (keyed on that
week's Monday, refreshed if it runs again the same week). Figures are running totals from
the Opportunities/Approvals tabs - `interviews` counts rows with an `interview_date` or a
status of `interview`/`offer`, so it never drops when a role moves on to an offer.

## Config (editable knobs - override defaults without a redeploy)
`key, value` - e.g. `SCORE_THRESHOLD`, `DAILY_SOURCE_CAP`, `CHUNK_SIZE`, `AGENCY_DRAFTS_PER_RUN`.

## Status pipeline
`sourced -> scored -> queued_for_approval -> approved -> drafted -> submitted | sent -> responded -> interview -> offer | rejected`

- `sourced` - just ingested.
- `scored` - scored below threshold (parked) or errored.
- `queued_for_approval` - strong match; shown in Approvals.
- `drafted` - CV/cover built; Gmail draft ready (email) or flagged submit-manually (portal).
- `submitted`/`sent` - you actioned it (set manually).
- `responded` / `interview` / `offer` / `rejected` - outcomes you record.
