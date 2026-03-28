#!/usr/bin/env bash
set -euo pipefail

print_usage() {
  cat <<USAGE
Usage:
  $0 <repo-url-or-tree-url> <remote-branch> [local-branch]
  $0 <github-tree-url>

Examples:
  $0 https://github.com/hansonjs80-design/PTperfect.git codex/configure-automatic-push-settings-htqfkw
  $0 https://github.com/hansonjs80-design/PTperfect/tree/codex/configure-automatic-push-settings-htqfkw
USAGE
}

parse_tree_url() {
  local tree_url="$1"
  if [[ "$tree_url" =~ ^https://github\.com/([^/]+)/([^/]+)/tree/(.+)$ ]]; then
    local owner="${BASH_REMATCH[1]}"
    local repo="${BASH_REMATCH[2]}"
    local branch="${BASH_REMATCH[3]}"
    echo "https://github.com/${owner}/${repo}.git|${branch}"
    return 0
  fi
  return 1
}

if [[ $# -lt 1 ]]; then
  print_usage
  exit 1
fi

REPO_INPUT="$1"
REMOTE_BRANCH="${2:-}"
LOCAL_BRANCH="${3:-}"

if [[ -z "$REMOTE_BRANCH" ]]; then
  if parsed="$(parse_tree_url "$REPO_INPUT")"; then
    REPO_URL="${parsed%%|*}"
    REMOTE_BRANCH="${parsed#*|}"
  else
    echo "[ERROR] remote-branch is required unless a GitHub tree URL is provided."
    print_usage
    exit 1
  fi
else
  REPO_URL="$REPO_INPUT"
fi

LOCAL_BRANCH="${LOCAL_BRANCH:-$REMOTE_BRANCH}"

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
  cat <<EOF_ERR

[ERROR] Failed to fetch origin/$REMOTE_BRANCH
- Check network/proxy restrictions
- Check repository access permissions (PAT/SSH)
- If pushing to private repo over HTTPS, ensure credentials are configured
EOF_ERR
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
