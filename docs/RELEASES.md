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
RELEASE_DIR=/tmp/job-hunt-releases bash scripts/make-release.sh 2026-07-29
```
The zip is written to `releases/` by default, or to `RELEASE_DIR` when set. The output
directory is a build output and is gitignored.

`make-release.sh` refuses to run unless the working tree is clean, the generated bundle
matches a fresh bundle from `HEAD`, and the tracked release-content scan finds no secret or
PII pattern. It builds from `git archive HEAD`, writes the full source commit to
`VERSION.txt`, and never includes untracked files.

Before cutting a release, run and record:

```
npm test
for f in src/*.gs manual-install/Code.gs; do cp "$f" /tmp/job-hunt-syntax.js && node --check /tmp/job-hunt-syntax.js; done
bash tools/bundle.sh
git diff --exit-code -- manual-install/Code.gs
```

Inspect the result before sharing it:

```
unzip -Z1 /tmp/job-hunt-releases/job-hunt-autopilot-2026-07-29.zip
unzip -q /tmp/job-hunt-releases/job-hunt-autopilot-2026-07-29.zip -d /tmp/job-hunt-release-inspect
cat /tmp/job-hunt-release-inspect/job-hunt-autopilot/VERSION.txt
```

Confirm the root folder, `VERSION.txt`, `manual-install/Code.gs`, and expected docs are
present, and that no local config, credentials, or candidate data is present.

## Share the update
1. Complete and record the authenticated disposable Apps Script smoke test described in
   [SETUP.md](SETUP.md). No smoke test means no live deployment.
2. Upload the new zip to the shared Google Drive folder.
3. Keep the folder link stable; do not overwrite older dated zips (lets a recipient roll
   back if a release turns out to have a problem).
4. Announce the release with the zip filename, version, source commit, and verification
   record.

Live deployment is a separate explicit gate. Local tests, syntax checks, bundle parity, ZIP
inspection, and authenticated smoke evidence must all be complete before `clasp push` or
any live project update. The release script does not deploy or upload.

## Rollback and recovery

Keep every dated ZIP and its source commit. If a release behaves incorrectly, stop or remove
the affected triggers, preserve the failing row and alert, and restore the previous known
good ZIP or commit. Do not delete CRM data to recover from a duplicate run: claims, stored
artefact IDs, and draft IDs are the recovery record. After rollback, rerun `diagnose`, repeat
the disposable smoke test, and only then restore live triggers.

For project support, use the repository's [issue tracker](../issues) and
[documentation](../tree/main/docs) rather than a personal contact address or social profile.

## Before every release - public-content sweep
This repo is a public template. Anything sensitive in tracked release content is a bug and
must be removed before building or sharing the zip. Run the dependency-free release-content
test and inspect any reported file and line:
```
npm test -- --test-name-pattern='tracked release content'
```
The scan covers maintainer identity, personal LinkedIn URLs, live-looking email addresses,
and API-key patterns. The licence attribution uses the project contributor name and is not a
personal support channel.
