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

For project support, use the repository's issue tracker and documentation rather than a
personal contact address or social profile.

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
