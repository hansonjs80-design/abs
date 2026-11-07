#!/bin/bash
set -euo pipefail

git add --all
if git diff --cached --quiet; then
  echo "Nothing to commit"
  exit 0
fi

git commit -m "auto commit $(date -Iseconds)"
node scripts/create-local-supabase-backup.mjs --pre-push --if-older-than-hours=6 || true
git push origin main
