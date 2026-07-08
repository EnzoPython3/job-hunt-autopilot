# Setup - clasp / developer path

The technical, terminal-based install. **Non-technical users should use
[../QUICKSTART.md](../QUICKSTART.md) instead** (no terminal needed). About 30-40 minutes.

## 0. Decide the host Google account
The Apps Script project should live in the Google account whose **Gmail sends the outreach**
and whose **Calendar** holds interviews - i.e. the candidate's own Google account. Do the
`clasp login` below as that account.

## 1. Install clasp and log in
```
npm install -g @google/clasp
clasp login
```
Enable the Apps Script API once at https://script.google.com/home/usersettings (toggle on).

## 2. Create the Apps Script project and push the code
From the repo root:
```
cp .clasp.json.example .clasp.json          # or let `clasp create` write it
clasp create --type standalone --title "Job-Hunt Autopilot" --rootDir src
clasp push
```
If `clasp create` wrote its own `.clasp.json`, make sure it has `"rootDir": "src"`.

## 3. Set Script Properties (secrets + your profile)
Apps Script editor -> Project Settings (gear) -> Script Properties -> add:
- `GEMINI_API_KEY` - from Google AI Studio (aistudio.google.com/app/apikey)
- `GEMINI_MODEL` - optional, defaults to `gemini-2.5-flash`
- `ADZUNA_APP_ID` and `ADZUNA_APP_KEY` (or `ADZUNA_API_KEY`) - free dev keys from https://developer.adzuna.com
- `RAPIDAPI_KEY` - from https://rapidapi.com after subscribing to **JSearch** (jsearch.p.rapidapi.com).
  Adds Indeed/LinkedIn/Glassdoor/PNet coverage. Free tier (~200 calls/month) covers ~4
  queries/day; leave unset to run Adzuna-only.
- `MASTER_CV_DOC_ID` - see step 4
- `CANDIDATE_JSON` - **your profile** as a JSON string (name, email, phone, location,
  linkedin, tracks, geos, keywords, salaryTargetNet, summary). If set it overrides the
  default in `src/Config.gs`. See `config.example.json` for the shape.

(`SHEET_ID` and `DRIVE_FOLDER_ID` are created for you in step 5.)

## 4. Create the master CV Google Doc
1. Make a Google Doc from `cv/TEMPLATE-CV.md` (clean, single column - ATS safe) with your
   real experience.
2. Replace the professional-summary paragraph with the literal token `{{SUMMARY}}`.
3. Copy the Doc's ID from its URL and set it as `MASTER_CV_DOC_ID`.
Per role, the loop copies this Doc and swaps `{{SUMMARY}}` for a tailored summary.

## 5. Bootstrap
In the Apps Script editor, run **`setupProject`** once and authorise the scopes when
prompted. It creates the CRM spreadsheet + Drive folder and records their IDs. Open the
logged spreadsheet URL and keep it handy.

## 6. Add job sources and agencies
- Open `src/Config.gs` -> `adzunaCountries()` / `adzunaQueries()` and set your country codes
  and search terms. Optionally add company boards in `atsBoards()` (Greenhouse/Lever/Ashby/
  Workable slugs). Adzuna + JSearch work out of the box.
- In the CRM `Contacts` tab, add recruitment agencies (`type` = `agency`, with a real
  `email`). Start from `data/agencies.sample.csv` and fill in each agency's application
  email from their official site. (Or paste that CSV into an `AGENCIES_CSV` Script Property
  before running `setupProject`.)

## 7. Test, then schedule
Run manually in this order and check the CRM after each:
1. `dailySource` - jobs appear in `Opportunities` (status `sourced`).
2. `scoreQueue` - rows get `fit_score`/`track`; strong ones appear in `Approvals`.
3. Tick `Approve` on one `Approvals` row, then run `prepApprovedBatch` - a tailored CV/cover
   PDF lands in the Drive folder and (if the posting had an email) a Gmail draft is created.
4. `weeklyReport` - a summary draft appears in Gmail.

When happy, run **`installTriggers`** to start the daily/hourly loop.

## Notes
- Everything is a **draft** - review and send/submit by hand.
- Tune behaviour in the CRM `Config` tab (e.g. lower `SCORE_THRESHOLD` for more volume).
- The manifest timezone is `Africa/Johannesburg` (`src/appsscript.json`) - change it to
  your own so the daily 06:00 trigger fires at your local morning.

## Prerequisites (developer path)
- **Node.js** 18+ and **npm** (for `clasp`).
- **clasp** (`npm install -g @google/clasp`).
- The **Apps Script API** enabled once at https://script.google.com/home/usersettings.
- Free API keys: Gemini (AI Studio), Adzuna dev keys, and optionally RapidAPI/JSearch.

## Project structure
```
src/                 the Apps Script project (clasp rootDir) - SOURCE OF TRUTH
  Config.gs          Script-Property keys, tunable defaults, candidate profile
  Sources.gs         job ingestion (JSearch + Adzuna + optional ATS feeds) + dedup
  Match.gs           Gemini fit-scoring -> Approvals queue
  Tailor.gs          per-role tailored CV (Docs {{SUMMARY}} merge) + cover letter
  Outreach.gs        Gmail drafts only (never auto-sends)
  Crm.gs             the Google Sheet CRM: schema + all reads/writes
  Onboarding.gs      the in-sheet "Setup" tab wizard (applySetup writes profile+keys)
  SheetUi.gs         dropdowns, applied_date auto-stamp, Readme tab, onEdit router
  Loop.gs Triggers.gs  trigger entry points + the daily/hourly scheduler
  Digest.gs Report.gs InterviewPrep.gs  morning digest, weekly funnel, interview prep
  Gemini.gs Prompts.gs  LLM wrapper + prompt templates (no-fabrication rules)
  Setup.gs           one-time setupProject() bootstrap
  Diagnostics.gs     diagnose() self-test of keys + live sources
manual-install/Code.gs   GENERATED bundle of all src/*.gs (for the no-terminal path)
tools/bundle.sh          regenerates the bundle from src/
cv/TEMPLATE-CV.md        master-CV skeleton with the {{SUMMARY}} token
data/agencies.sample.csv starter recruitment-agency list (fill in emails)
docs/                    SETUP (this file), RUNBOOK (daily use), SHEET_SCHEMA
```

## Regenerating the single-file bundle
`manual-install/Code.gs` is generated from `src/`. After editing anything under `src/`,
rebuild it so the no-terminal install stays in sync:
```
bash tools/bundle.sh
```
A new `src/*.gs` file must also be added to the `ORDER` list in `tools/bundle.sh` (the
script errors out if it isn't, to stop a file being silently dropped from the bundle).

## Secrets hygiene
- No secrets live in the code - everything is read from Script Properties at runtime.
- `.gitignore` excludes `.env`, `.clasp.json`, and `config.json`; keep it that way. Never
  commit real keys. `config.example.json` and `.clasp.json.example` are placeholders.
