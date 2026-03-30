#!/usr/bin/env bash
set -euo pipefail

print_usage() {
  cat <<USAGE
Usage:
  $0 [--ssh-fingerprint <SHA256:...>] <repo-url-or-tree-url> <remote-branch> [local-branch]
  $0 [--ssh-fingerprint <SHA256:...>] <github-tree-url>

Examples:
  $0 https://github.com/hansonjs80-design/PTperfect.git codex/configure-automatic-push-settings-htqfkw
  $0 https://github.com/hansonjs80-design/PTperfect/tree/codex/configure-automatic-push-settings-htqfkw
  $0 --ssh-fingerprint SHA256:xxxx https://github.com/org/repo/tree/main
USAGE
}

parse_tree_url() {
  local tree_url="$1"
  if [[ "$tree_url" =~ ^https://github\.com/([^/]+)/([^/]+)/tree/(.+)$ ]]; then
    local owner="${BASH_REMATCH[1]}"
    local repo="${BASH_REMATCH[2]}"
    local branch="${BASH_REMATCH[3]}"
    echo "https://github.com/${owner}/${repo}.git|${branch}|git@github.com:${owner}/${repo}.git"
    return 0
  fi
  return 1
}

github_https_to_ssh() {
  local url="$1"
  if [[ "$url" =~ ^https://github\.com/([^/]+)/([^/]+)\.git$ ]]; then
    echo "git@github.com:${BASH_REMATCH[1]}/${BASH_REMATCH[2]}.git"
    return 0
  fi
  return 1
}

find_private_key_by_fingerprint() {
  local target_fp="$1"
  local pub

  shopt -s nullglob
  for pub in "$HOME"/.ssh/*.pub; do
    local fp
    fp="$(ssh-keygen -lf "$pub" 2>/dev/null | awk '{print $2}')"
    if [[ "$fp" == "$target_fp" ]]; then
      echo "${pub%.pub}"
      shopt -u nullglob
      return 0
    fi
  done
  shopt -u nullglob
  return 1
}

SSH_FINGERPRINT=""
if [[ "${1:-}" == "--ssh-fingerprint" ]]; then
  if [[ $# -lt 3 ]]; then
    print_usage
    exit 1
  fi
  SSH_FINGERPRINT="$2"
  shift 2
fi

if [[ $# -lt 1 ]]; then
  print_usage
  exit 1
fi

REPO_INPUT="$1"
REMOTE_BRANCH="${2:-}"
LOCAL_BRANCH="${3:-}"
SSH_REPO_URL=""

if [[ -z "$REMOTE_BRANCH" ]]; then
  if parsed="$(parse_tree_url "$REPO_INPUT")"; then
    REPO_URL="${parsed%%|*}"
    rest="${parsed#*|}"
    REMOTE_BRANCH="${rest%%|*}"
    SSH_REPO_URL="${rest#*|}"
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

# If fingerprint is provided, pin SSH key and switch origin to SSH URL when possible
if [[ -n "$SSH_FINGERPRINT" ]]; then
  if ! KEY_PATH="$(find_private_key_by_fingerprint "$SSH_FINGERPRINT")"; then
    echo "[ERROR] Could not find local key for fingerprint: $SSH_FINGERPRINT"
    echo "- Ensure the key exists under ~/.ssh and has a matching .pub file"
    exit 3
  fi

  if [[ -z "$SSH_REPO_URL" ]]; then
    if SSH_REPO_URL="$(github_https_to_ssh "$REPO_URL")"; then
      :
    else
      echo "[ERROR] Could not derive SSH URL from: $REPO_URL"
      echo "- Provide a GitHub HTTPS URL ending with .git, or use a GitHub tree URL"
      exit 4
    fi
  fi

  git config --local core.sshCommand "ssh -i $KEY_PATH -o IdentitiesOnly=yes"
  REPO_URL="$SSH_REPO_URL"
fi

# Add or update origin
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REPO_URL"
else
  git remote add origin "$REPO_URL"
fi

echo "Configured origin: $(git remote get-url origin)"
echo "Configured push.default=$(git config --local --get push.default)"
echo "Configured push.autoSetupRemote=$(git config --local --get push.autoSetupRemote)"
if [[ -n "$SSH_FINGERPRINT" ]]; then
  echo "Configured core.sshCommand=$(git config --local --get core.sshCommand)"
fi

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
