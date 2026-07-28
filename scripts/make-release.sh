#!/usr/bin/env bash
#
# make-release.sh - build a versioned, shareable zip of this repo.
#
# Sources ONLY git-tracked files via `git archive` - anything not committed
# (secrets, local scratch files, an accidentally-untracked personal file) can
# never end up in the zip. Do not switch this to a manual file-copy list: that
# would silently include whatever happens to be on disk, tracked or not.
#
# Usage:
#   ./scripts/make-release.sh              # version = today's date
#   ./scripts/make-release.sh 2026-07-14   # explicit version
#   RELEASE_DIR=/tmp/releases ./scripts/make-release.sh 2026-07-14
#
set -euo pipefail

version="${1:-$(date +%F)}"
bundle_name="job-hunt-autopilot"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release_dir="${RELEASE_DIR:-$repo_root/releases}"
build_root="$(mktemp -d "${TMPDIR:-/tmp}/job-hunt-release.XXXXXX")"
bundle_root="$build_root/$bundle_name"
zip_path="$release_dir/${bundle_name}-${version}.zip"

cleanup() {
  rm -rf "$build_root"
}
trap cleanup EXIT

fail() {
  echo "release refused: $*" >&2
  exit 1
}

cd "$repo_root"

if [ -n "$(git status --porcelain)" ]; then
  fail "working tree must be clean and all release changes must be committed"
fi

commit="$(git rev-parse HEAD)"

if ! node --test test/bundle.test.mjs --test-name-pattern='tracked release content' >/dev/null; then
  fail "forbidden secret or PII pattern found in tracked release content"
fi

bundle_check="$build_root/bundle-check"
mkdir -p "$bundle_check"
git archive HEAD | tar -x -C "$bundle_check"
(cd "$bundle_check" && bash tools/bundle.sh >/dev/null)
if ! cmp -s "$bundle_check/manual-install/Code.gs" "$repo_root/manual-install/Code.gs"; then
  fail "manual-install/Code.gs is stale; run bash tools/bundle.sh and commit the result"
fi

mkdir -p "$bundle_root" "$release_dir"
(git archive HEAD) | tar -x -C "$bundle_root"
cat > "$bundle_root/VERSION.txt" <<EOF
Release version: $version
Bundle root: $bundle_name
Source commit: $commit
Built: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF

rm -f "$zip_path"
(cd "$build_root" && zip -qr "$zip_path" "$bundle_name")

printf 'Built %s\n' "$zip_path"
