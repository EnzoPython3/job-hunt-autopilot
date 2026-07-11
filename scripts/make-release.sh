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
#
set -euo pipefail

version="${1:-$(date +%F)}"
bundle_name="job-hunt-autopilot"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release_dir="$repo_root/releases"
build_root="$(mktemp -d "${TMPDIR:-/tmp}/job-hunt-release.XXXXXX")"
bundle_root="$build_root/$bundle_name"
zip_path="$release_dir/${bundle_name}-${version}.zip"

if [ -n "$(cd "$repo_root" && git status --porcelain)" ]; then
  echo "warning: working tree has uncommitted changes - the release is built from the" >&2
  echo "last COMMIT (git archive HEAD), so uncommitted edits will NOT be included." >&2
fi

mkdir -p "$bundle_root" "$release_dir"
(cd "$repo_root" && git archive HEAD) | tar -x -C "$bundle_root"

commit="$(cd "$repo_root" && git rev-parse --short HEAD)"
cat > "$bundle_root/VERSION.txt" <<EOF
Release version: $version
Bundle root: $bundle_name
Source commit: $commit
Built: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF

rm -f "$zip_path"
(cd "$build_root" && zip -qr "$zip_path" "$bundle_name")

printf 'Built %s\n' "$zip_path"
