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

make_ssh_url() {
  local url="$1"
  if [[ "$url" =~ ^https://github\.com/(.+)/(.+)\.git$ ]]; then
    echo "git@github.com:${BASH_REMATCH[1]}/${BASH_REMATCH[2]}.git"
    return 0
  fi
  return 1
}

sync_branch() {
  local branch="$1"

  if git show-ref --verify --quiet "refs/heads/$branch"; then
    git checkout "$branch"
    git reset --hard "origin/$REMOTE_BRANCH"
  else
    git checkout -B "$branch" --track "origin/$REMOTE_BRANCH"
  fi

  echo
  echo "Branch synchronized successfully."
  echo "Current branch: $(git rev-parse --abbrev-ref HEAD)"
  echo "Upstream: $(git rev-parse --abbrev-ref --symbolic-full-name @{u})"
}

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
echo "Fetching remote branch with HTTPS: $REMOTE_BRANCH"
if git fetch origin "$REMOTE_BRANCH"; then
  sync_branch "$LOCAL_BRANCH"
  echo
  echo "Next step after your changes:"
  echo "  git push -u origin $LOCAL_BRANCH"
  exit 0
fi

echo
echo "[WARN] HTTPS fetch failed. Trying SSH fallback for GitHub..."
if SSH_URL="$(make_ssh_url "$REPO_URL")"; then
  ORIGINAL_URL="$REPO_URL"
  git remote set-url origin "$SSH_URL"
  echo "Switched origin to SSH: $(git remote get-url origin)"

  if git fetch origin "$REMOTE_BRANCH"; then
    sync_branch "$LOCAL_BRANCH"
    echo
    echo "Next step after your changes:"
    echo "  git push -u origin $LOCAL_BRANCH"
    exit 0
  fi

  echo
  git remote set-url origin "$ORIGINAL_URL"
  echo "[ERROR] SSH fetch also failed."
  echo "- Restored origin to: $(git remote get-url origin)"
  echo "- Ensure your SSH key is added to GitHub and agent is configured"
  echo "- Ensure outbound SSH (port 22) is allowed"
  exit 3
fi

echo
 echo "[ERROR] Failed to fetch origin/$REMOTE_BRANCH"
echo "- Check network/proxy restrictions (e.g. CONNECT tunnel failed 403)"
echo "- Check repository access permissions (PAT/SSH)"
exit 2
