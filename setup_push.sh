#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <GITHUB_REPO_URL> [branch]"
  echo "Example: $0 https://github.com/hansonjs80-design/PTperfect.git codex/configure-automatic-push-settings-htqfkw"
  exit 1
fi

REPO_URL="$1"
BRANCH="${2:-$(git rev-parse --abbrev-ref HEAD)}"

# Configure safer defaults for first push on a new branch
git config --local push.default current
git config --local push.autoSetupRemote true

# Add or update origin
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REPO_URL"
else
  git remote add origin "$REPO_URL"
fi

echo "Configured origin: $(git remote get-url origin)"
echo "Configured push.default=$(git config --local --get push.default)"
echo "Configured push.autoSetupRemote=$(git config --local --get push.autoSetupRemote)"

echo
echo "Next step:"
echo "  git push -u origin $BRANCH"
