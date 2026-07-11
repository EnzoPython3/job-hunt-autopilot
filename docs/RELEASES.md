# Release process (maintainer-only)

This page is for whoever maintains this repo and shares the zip - not for the people
receiving it (they should start at `START-HERE.html` in the package root).

## What stays stable
- The zip's root folder name stays `job-hunt-autopilot/`.
- The zip filename is versioned, e.g. `job-hunt-autopilot-2026-07-14.zip`.
- This Git repository (`main`) remains the source of truth.

## Build a release
From the repo root:
```
bash scripts/make-release.sh              # version = today's date
bash scripts/make-release.sh 2026-07-14   # explicit version
```
The zip is written to `releases/` (gitignored - it's a build output, not source).

**Only committed, pushed content goes into the zip** - `make-release.sh` builds it via
`git archive HEAD`, so nothing untracked or uncommitted (secrets, scratch files, an
accidentally-unstaged personal file) can ever leak into it. Before cutting a release, run
`bash tools/bundle.sh` and commit/push so the paste-install bundle is current, then build
the release from the pushed `main`.

## Share the update
1. Upload the new zip to the shared Google Drive folder.
2. Keep the folder link stable; do not overwrite older dated zips (lets a recipient roll
   back if a release turns out to have a problem).
3. Announce the release with the zip filename and version.

## Before every release - PII sweep
This repo is a public template - anything sensitive here is either a bug or, if the sample
data legitimately needs it (none currently does), an explicit decision. Before sharing:
```
grep -rInE 'Lebo|Snyman|Relebogile|lebosnyman3|Inceptum|Gabisile|Ntlama' --exclude-dir=.git .
```
The only expected hit is the LICENSE copyright line. Anything else - stop and fix it before
building or sharing the zip.
