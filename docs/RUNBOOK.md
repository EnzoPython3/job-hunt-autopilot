# Runbook - daily use and tuning

## The daily 10 minutes (human)
1. Open the CRM spreadsheet -> **Approvals** tab.
2. For each row, read `role`, `company`, `fit_score`, `rationale`, open the `url`.
3. Pick `Approve` (or `Skip`) from the `decision` dropdown. Add anything useful in `edited_notes`.
4. Within ~2 hours `prepApprovedBatch` runs and, for approved rows:
   - drops a tailored **CV + cover PDF** in the Drive folder (links land on the `Opportunities` row), and
   - for postings with a contact email, creates a **Gmail draft** with the CV attached.
5. Open **Gmail -> Drafts**, review each draft, tweak, and **send**.
6. For portal-only roles (no email), open the job link and **submit manually** with the tailored CV + cover.
7. Mark progress on the `Opportunities` row using the `status` dropdown: pick `sent`/`submitted` (`applied_date` fills in with today automatically), and later `responded` / `interview` (add `interview_date`). The sheet's **Readme** tab has the full what-to-do-when reference.

## Agency outreach (weekly)
Run `draftAgencyOutreach` (or let it run on a light schedule). It creates one Gmail draft per un-contacted agency in the `Contacts` tab. Review and send. Agencies are a high-yield channel for SA customer-service roles.

## The automated loop (triggers)
- `dailySource` - daily 06:00: pull + dedup new jobs (JSearch + Adzuna + ATS feeds; Adzuna's redirect links are validated and dead ones dropped, JSearch/ATS links are direct).
- `scoreQueue` - hourly: score `sourced` jobs, queue strong ones.
- `prepApprovedBatch` - every 2 hours: build assets for `Approve` rows.
- `followUps` - daily 08:00: draft +3/+7 day nudges (Gmail drafts) for no-response sends.
- `prepInterviews` - daily 09:00: generate an interview-prep pack (Google Doc) for any role you mark `interview`.
- `weeklyReport` - Monday 07:00: funnel summary draft vs the 2-5 interview target.

## Tuning (CRM `Config` tab - no redeploy needed)
- `SCORE_THRESHOLD` (default 62): lower = more volume in Approvals, higher = stricter.
- `DAILY_SOURCE_CAP`, `CHUNK_SIZE`, `AGENCY_DRAFTS_PER_RUN`: throughput knobs.
- Widen reach in `Config.gs`: add Adzuna countries/queries, add `jsearchQueries()` terms, add ATS boards. Loosen JSearch freshness with `jsearchDatePosted()` (`week` -> `month`) for more volume.

## If interviews are below target
1. Lower `SCORE_THRESHOLD` and widen `adzunaQueries()`/geos.
2. Add more `atsBoards()` (target SA BPO employers directly).
3. Push agency outreach harder (`draftAgencyOutreach`).
4. Check the weekly report's funnel to see where drop-off happens (queued -> sent -> response -> interview).

## Maintenance
- `pruneDeadLinks` - follow every stored job link and retire the dead ones (Opportunities -> `dead_link`, Approvals -> `Skip - dead link`). Run it once to clear an old backlog of expired links, then re-run if it reports it was capped. New jobs are already link-checked on ingest, so this is only for cleanup.
- `diagnose` - prints which Script Properties are set and live-tests JSearch + Adzuna + Gemini + the sheet. Run it if a source stops returning jobs.
- After any change to the project's OAuth scopes (e.g. the manifest), open the editor, run `diagnose` once and **re-grant permissions**, then re-run `installTriggers`. If the morning digest ever stops arriving, this is the first thing to check - the log will show `morningDigest: SEND FAILED` on a missing `script.send_mail` grant.

## Safety
- Nothing sends itself. Drafts only.
- The CV/cover prompts forbid fabrication; spot-check the first few tailored outputs.
- Keep your current salary off every output (it never appears; salary is internal only).
