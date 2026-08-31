#!/usr/bin/env bash
# Pre-push guard: origin must always push to the canonical dsh-web repository.
#
# Incident (2026-08-31, PR #1299 flow): a stale remote.origin.pushurl pointed at
# the contributor's fork after the force-push to the PR branch, so the next
# `git push origin dev` silently targeted the wrong repository (it only failed
# because that fork denied write). Never re-point origin or its push URL at a
# fork; push to contributor forks only through an explicitly named one-off
# remote (`git remote add <name> <fork-url>`) or a direct URL.
#
# Install into a checkout: ln -sf ../../scripts/git-pre-push-guard.sh .git/hooks/pre-push
# Hook arguments (git pre-push): <remote name> <remote URL>
set -uo pipefail

CANONICAL='https://github.com/zhu1090093659/dsh-web'
remote="${1:-}"
url="${2:-}"

# A push to an explicitly named fork remote or a direct URL is fine; only
# 'origin' is pinned to the canonical repository.
[ "$remote" = "origin" ] || exit 0

# git passes the URL it will actually push to (remote.origin.pushurl wins).
[ -n "$url" ] || url="$(git config --get remote.origin.url || true)"
[ -n "$url" ] || exit 0

# Accept the URL with or without the trailing .git.
[ "${url%.git}" = "$CANONICAL" ] && exit 0

cat >&2 <<EOF
pre-push: BLOCKED - the push URL for 'origin' is '${url}', not the canonical
pre-push: repository (${CANONICAL}). origin must always resolve to the canonical
pre-push: repo; if a contributor-fork push repointed it, restore with:
pre-push:   git remote set-url origin ${CANONICAL}
pre-push:   git config --unset remote.origin.pushurl
pre-push: Push to forks only via a named remote (git remote add <name> <fork-url>).
EOF
exit 1
