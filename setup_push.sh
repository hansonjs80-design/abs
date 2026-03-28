#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <GITHUB_REPO_URL> <remote-branch> [local-branch]"
  echo "Example: $0 https://github.com/hansonjs80-design/PTperfect.git codex/configure-automatic-push-settings-htqfkw"
  exit 1
fi

REPO_URL="$1"
REMOTE_BRANCH="$2"
LOCAL_BRANCH="${3:-$REMOTE_BRANCH}"

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
echo "Fetching remote branch: $REMOTE_BRANCH"
if ! git fetch origin "$REMOTE_BRANCH"; then
  echo
  echo "[ERROR] Failed to fetch origin/$REMOTE_BRANCH"
  echo "- Check network/proxy restrictions (e.g. CONNECT tunnel failed 403)"
  echo "- Check repository access permissions (PAT/SSH)"
  exit 2
fi

# Checkout local branch and track remote branch
if git show-ref --verify --quiet "refs/heads/$LOCAL_BRANCH"; then
  git checkout "$LOCAL_BRANCH"
  git reset --hard "origin/$REMOTE_BRANCH"
else
  git checkout -B "$LOCAL_BRANCH" --track "origin/$REMOTE_BRANCH"
fi

echo
echo "Branch synchronized successfully."
echo "Current branch: $(git rev-parse --abbrev-ref HEAD)"
echo "Upstream: $(git rev-parse --abbrev-ref --symbolic-full-name @{u})"

echo
echo "Next step after your changes:"
echo "  git push -u origin $LOCAL_BRANCH"
