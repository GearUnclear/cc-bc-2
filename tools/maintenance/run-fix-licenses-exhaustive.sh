#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

DEFAULT_ARGS=(
  --concurrency 1
  --retries 8
  --timeout-ms 30000
  --sleep-ms 60000
  --stop-after-no-progress-passes 8
)

echo "Running exhaustive license fixer with defaults:"
echo "  ${DEFAULT_ARGS[*]}"
echo ""

npm run fix:licenses-exhaustive -- "${DEFAULT_ARGS[@]}" "$@"
