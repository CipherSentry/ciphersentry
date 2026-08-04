#!/usr/bin/env bash
# Freeze hash for DOC-07 / G3 / Orynth listing pack.
# sha256(concat of sorted cipher/contracts/src/**/*.sol)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/cipher/contracts/src"
if [[ ! -d "$SRC" ]]; then
  echo "missing $SRC" >&2
  exit 1
fi
# portable: find + sort + cat | sha256sum
HASH=$(
  cd "$SRC"
  find . -name '*.sol' -type f | sed 's|^\./||' | sort | while read -r f; do
    cat "$f"
  done | sha256sum | awk '{print $1}'
)
echo "$HASH"
# also print file list for audit trail
if [[ "${VERBOSE:-}" == "1" ]]; then
  echo "--- files ---" >&2
  (cd "$SRC" && find . -name '*.sol' -type f | sed 's|^\./||' | sort) >&2
fi
