# Quick Start - Job-Hunt Autopilot

A gentle, no-coding-required setup. It runs inside your own Google account and every
morning it finds jobs that fit you, writes a tailored CV and cover letter for the ones you
approve, and prepares email drafts for you to review.

**It never sends anything by itself.** You always approve and click send. Think of it as an
assistant that does the boring 90%, not a robot that applies for you.

Total setup time: about **30-40 minutes**, most of it just making free accounts.

---

## What you need first
- A **Google account** (Gmail). The tool lives here and sends drafts from here.
- **Three free keys** you'll collect in Part 1 (10 minutes). No credit card needed.

> Prefer a terminal / are technical? Skip to the **Appendix (clasp path)** at the bottom.

---

## Part 1 - Get your three free keys

Open each link, sign in, copy the key somewhere temporary (a blank note). You'll paste them
into the tool in Part 4.

1. **Gemini (the AI brain)** - go to https://aistudio.google.com/app/apikey -> **Create API
   key**. Copy it. (Free.)
2. **Adzuna (a job source)** - go to https://developer.adzuna.com -> sign up -> you'll get an
   **App ID** and an **App Key**. Copy both. (Free.)
3. **RapidAPI / JSearch (extra job coverage - optional)** - go to https://rapidapi.com, make
   an account, search for **JSearch**, click **Subscribe** and pick the **Free** plan, then
   copy your **RapidAPI key**. This adds LinkedIn/Indeed/Glassdoor/PNet-style results. You
   can skip it and add it later - the tool still works on Adzuna alone.

---

## Part 2 - Put the code into Google (no terminal)

1. Go to **https://script.google.com** and click **New project** (top-left).
2. You'll see a file called `Code.gs` with a couple of lines in it. Select all of that and
   delete it.
3. Open the file **`manual-install/Code.gs`** from this pack, select **everything**, copy it,
   and paste it into that empty `Code.gs`. Press **Save** (the disk icon).
4. Rename the project (top-left, "Untitled project") to **Job-Hunt Autopilot**.

That's the whole program pasted in. You don't need to understand it.

---

## Part 3 - Create the sheet (one click)

1. In the toolbar there's a **function dropdown** (says something like `myFunction`). Click it
   and choose **`setupProject`**.
2. Click **Run**. Google will ask you to **review permissions** - choose your account, click
   **Advanced** -> **Go to Job-Hunt Autopilot (unsafe)** -> **Allow**. (This is normal: it's
   your own script asking to use your Sheets/Drive/Gmail.)
3. When it finishes, open the **Execution log** at the bottom - it prints a link to your new
   **Job-Hunt CRM** spreadsheet. Open that link and keep the tab open. This sheet is your
   whole dashboard.

---

## Part 4 - Answer the questions (this is the important bit)

In the spreadsheet you just opened, go to the **Setup** tab (first tab).

1. Fill in **column B** next to each question: your name, email, phone, location, LinkedIn,
   the roles you want, your regions, your skills, and a one-line summary of yourself. (Some
   cells are pre-filled with a South-African example - just type over them.)
2. Paste your keys from Part 1 into the **API KEYS** rows (Gemini, Adzuna App ID, Adzuna App
   Key, and RapidAPI if you got one).
3. (Optional) Under **SEARCH FILTERS**, narrow things down:
   - **Keep only these regions** - e.g. `Sandton, Midrand, Johannesburg` to keep only jobs in
     those areas. Blank = anywhere. Remote jobs, jobs with no stated location, and jobs tagged
     with just a bare region or country (a plain "Gauteng" or "South Africa") still pass; a job
     naming a specific town outside your list is dropped.
   - **Drop these sub-areas** - e.g. `kempton park, pretoria` to drop specific places even when
     they fall inside a kept region. Blank = none.
   - **Allow remote from anywhere** - `true` keeps remote jobs worldwide even when you've
     restricted regions; `false` to drop them.
   - **Exclude job boards** - e.g. `careers24` to never see jobs from a board you dislike.
   - **Tailor for portal roles** - `true` (default) writes a custom CV + cover for every
     approved job; `false` does that only for jobs that have an email to apply to (portal
     jobs then just get a link to apply by hand - saves AI quota).
4. When you're done, **tick the "Save" checkbox** at the bottom.
   - If nothing happens (the Save box only works after Part 6), instead go back to the script
     tab, choose **`applySetup`** in the function dropdown, and click **Run**.
5. The **Status** row shows "Saved ...". Your keys are now stored securely and the key cells
   are cleared on purpose.

You can come back and change any answer any time - fill it in and Save again. To remove a
search filter you set earlier, blank its cell and Save - the filter is cleared.

---

## Part 5 - Add your CV

**Easy way (recommended):** in the script tab, choose **`buildMasterCv`** in the function
dropdown and click **Run**. It creates a clean, ATS-safe master CV Doc (formatted for you,
with the `{{SUMMARY}}` token) and wires up `MASTER_CV_DOC_ID` automatically. Then open that
Doc (the link is in the Execution log) and replace the placeholder experience/education with
your real history - **keep it single column and keep the `{{SUMMARY}}` line**. Done.

**Manual way:** if you'd rather build it yourself:
1. Open **`cv/TEMPLATE-CV.md`** from this pack. Make a **Google Doc** version of your real CV
   using it as a guide (keep it simple: one column, no tables or images).
2. Where your personal summary goes, type the exact text **`{{SUMMARY}}`** (with the double
   curly braces). The tool swaps this out with a tailored summary for each job.
3. In the Doc's web address (URL), copy the long **ID** between `/d/` and `/edit`.
4. Back in the **Setup** tab, paste that ID into **"Master CV Google Doc ID"** and **Save**
   again (or run `applySetup`).

---

## Part 6 - Test it once, then turn on autopilot

Back in the **script** tab, run these from the function dropdown, one at a time (click Run,
wait for "Execution completed"), checking the spreadsheet after each:

1. **`dailySource`** - jobs appear on the **Opportunities** tab.
2. **`scoreQueue`** - the AI scores them; strong ones show up on the **Approvals** tab.
3. On the **Approvals** tab, pick **Approve** in the `decision` column for one job.
4. **`prepApprovedBatch`** - within a moment a tailored CV + cover PDF lands in your Drive
   folder, and (if the job had an email) a **draft** appears in your Gmail.

Happy with that? Run **`installTriggers`** once. From now on it runs **every morning by
itself** and the Save checkbox on the Setup tab works too.

> Timezone: the daily run is set to **06:00 Johannesburg time**. To change it, in the script
> tab open **Project Settings** and set your timezone (or ask whoever gave you this pack).

---

## Your daily 10 minutes

1. Open the spreadsheet -> **Approvals** tab. For each row read the role, company, score and
   reasoning, open the link, and pick **Approve** or **Skip**.
2. A bit later, open **Gmail -> Drafts**. Review each prepared email, tweak it, and **send**.
   For jobs that only take portal applications, open the link and apply by hand using the CV
   and cover from your Drive folder.
3. On the **Opportunities** tab, set the `status` to **sent** or **submitted** - the date
   fills in automatically. Later mark **responded** / **interview** as things progress.

The sheet's **Readme** tab has this same guide, always one click away.

---

## What it costs and its limits
- All three services have **free tiers**. In practice that's about **one run per morning** -
  plenty for a real job search. No card required.
- Everything the AI writes is grounded in the facts you gave it. **It will not invent jobs,
  employers or numbers**, and your salary is never printed anywhere.

## If something looks wrong
In the script tab, run **`diagnose`** and read the log - it checks each key and each job
source and tells you what's missing.

---

## Appendix - technical (clasp) path
If you're comfortable with a terminal, you can deploy the split `src/` files instead of the
pasted bundle. See **[docs/SETUP.md](docs/SETUP.md)** for the `clasp` flow, then do Parts 4-6
above the same way. Tuning knobs and the full daily runbook are in
**[docs/RUNBOOK.md](docs/RUNBOOK.md)**; the sheet layout is in
**[docs/SHEET_SCHEMA.md](docs/SHEET_SCHEMA.md)**.
