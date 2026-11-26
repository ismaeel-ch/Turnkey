#!/usr/bin/env bash
# Runs one heavy command at a time across every checkout on this machine.
#   scripts/heavy.sh npm run build
#   scripts/heavy.sh npm run test:e2e -- demo
# Builds and browser tests each want both cores and over a gigabyte of memory. When several agents work in
# parallel worktrees, running them at once makes all of them slow or kills them. This waits for its turn instead.
set -euo pipefail
LOCK="${TURNKEY_HEAVY_LOCK:-/tmp/turnkey-heavy.lock}"
if command -v flock >/dev/null 2>&1; then
  exec flock -w 3600 "$LOCK" "$@"
else
  exec "$@"
fi
