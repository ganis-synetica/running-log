#!/usr/bin/env bash
# Rebuild the running log from local Apple Health data and commit the result.
# Usage: ./scripts/sync.sh [--no-commit]
set -euo pipefail
cd "$(dirname "$0")/.."

python3 scripts/build_data.py

if [[ "${1:-}" == "--no-commit" ]]; then
  echo "→ skipped commit (--no-commit)"
  exit 0
fi

if git diff --quiet -- data/; then
  echo "→ no changes to commit"
else
  git add data/
  git commit -m "chore: sync running data from Apple Health export"
  echo "→ committed. Run 'git push' to deploy."
fi
