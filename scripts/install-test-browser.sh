#!/usr/bin/env bash
# Installs the test browser (Chromium) and the system packages it needs, on a GitHub Actions runner.
#   scripts/install-test-browser.sh
# `playwright install --with-deps` runs apt-get update first, and that fails the whole install whenever any package
# source on the runner is down. The runner's Microsoft source (packages.microsoft.com) has answered 403 more than once,
# and the browser needs nothing from it, so it is dropped first. Any other network error gets two more tries.
set -euo pipefail
if [ "$(uname -s)" = "Linux" ] && command -v sudo >/dev/null 2>&1 && [ -d /etc/apt/sources.list.d ]; then
  sudo grep -rl 'packages.microsoft.com' /etc/apt/sources.list.d/ 2>/dev/null | xargs -r sudo rm -f || true
fi
for attempt in 1 2 3; do
  if npx playwright install --with-deps chromium; then
    exit 0
  fi
  if [ "$attempt" -lt 3 ]; then
    echo "Installing the test browser failed (attempt $attempt of 3). Trying again in $((attempt * 20)) seconds."
    sleep $((attempt * 20))
  fi
done
echo "Installing the test browser failed three times."
exit 1
