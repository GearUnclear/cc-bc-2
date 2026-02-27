#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="/var/www/music.wagenhoffer.dev"
DRY_RUN=0
SKIP_VERSION_ASSETS=0

usage() {
  cat <<'EOF'
Deploy static app files to a live /var/www target.

Usage:
  scripts/deploy-live.sh [--target /var/www/path] [--dry-run] [--skip-version-assets]

Options:
  --target PATH           Deployment target. Default: /var/www/music.wagenhoffer.dev
  --dry-run               Print actions without writing files.
  --skip-version-assets   Do not run npm run version-assets before sync.
  -h, --help              Show this help.
EOF
}

print_cmd() {
  printf '%s' "$1"
  shift
  for arg in "$@"; do
    printf ' %q' "$arg"
  done
  printf '\n'
}

run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    print_cmd "[dry-run]" "$@"
    return 0
  fi
  "$@"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      shift
      if [[ $# -eq 0 ]]; then
        echo "Missing value for --target" >&2
        exit 1
      fi
      TARGET_DIR="$1"
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    --skip-version-assets)
      SKIP_VERSION_ASSETS=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
  shift
done

for required in index.html app.js styles.css public; do
  if [[ ! -e "$ROOT_DIR/$required" ]]; then
    echo "Missing required source: $ROOT_DIR/$required" >&2
    exit 1
  fi
done

echo "Deploy source: $ROOT_DIR"
echo "Deploy target: $TARGET_DIR"

run npm --prefix "$ROOT_DIR" run generate:license-counts

if [[ "$SKIP_VERSION_ASSETS" -eq 0 ]]; then
  run npm --prefix "$ROOT_DIR" run version-assets
else
  echo "Skipping asset version stamping (--skip-version-assets)."
fi

run install -d "$TARGET_DIR"
run install -d "$TARGET_DIR/public"
run install -m 0644 "$ROOT_DIR/index.html" "$TARGET_DIR/index.html"
run install -m 0644 "$ROOT_DIR/app.js" "$TARGET_DIR/app.js"
run install -m 0644 "$ROOT_DIR/styles.css" "$TARGET_DIR/styles.css"
run install -m 0644 "$ROOT_DIR/favicon.svg" "$TARGET_DIR/favicon.svg"

if [[ "$DRY_RUN" -eq 1 ]]; then
  print_cmd "[dry-run]" rsync -a --delete "$ROOT_DIR/public/" "$TARGET_DIR/public/"
else
  rsync -a --delete "$ROOT_DIR/public/" "$TARGET_DIR/public/"
fi

if [[ "$DRY_RUN" -eq 0 ]]; then
  node -e 'const fs=require("fs");const rows=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const favs=rows.filter((r)=>Boolean(r.favorite)).length;console.log(`urls.json rows=${rows.length} favorites=${favs}`);' "$TARGET_DIR/public/urls.json"
fi

echo "Deploy complete."
