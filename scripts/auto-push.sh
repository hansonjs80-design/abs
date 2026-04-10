#!/bin/bash
set -euo pipefail

git add --all
if git diff --cached --quiet; then
  echo "Nothing to commit"
  exit 0
fi

git commit -m "auto commit $(date -Iseconds)"
git push origin main
