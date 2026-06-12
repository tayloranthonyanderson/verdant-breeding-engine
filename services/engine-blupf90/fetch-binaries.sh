#!/usr/bin/env bash
# Fetch the BLUPF90 Linux x86_64 binaries into bin/ (gitignored — not committed; third-party,
# research-use license). Source: UGA Animal Breeding & Genetics (Misztal lab). Commercial use
# requires a UGA license agreement — see ADR-0014.
#
# SHA-256 sums are pinned. If a download fails the check, upstream changed (these are rolling
# "Test_static" builds) — review the new binary and update the pin deliberately.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/bin"
BASE="https://nce.ads.uga.edu/html/projects/programs/Linux/Test_static"
mkdir -p "$DIR"

# program            expected sha256
PINS="
blupf90+ 7f898a2927e0d1486603279e06a2717aaedaed5209c8449f0b7b89d8d70763cf
renumf90 93e2817fa27761dba024731ca8ccc1332b4e5f9bc512d570bbe55f12efc88cf5
preGSf90 2449b700e885e575ebe110682f47542c160e44667d25c4d4d62714b473d44caf
postGSf90 65b35fca6f8242da7fe53275d5629f482b9caec8932a6e75916d5bb0d47d0b9f
"

echo "$PINS" | while read -r prog want; do
  [ -z "$prog" ] && continue
  echo "fetching $prog ..."
  curl -fSL --retry 3 --max-time 300 -o "$DIR/$prog" "$BASE/$prog"
  got="$(shasum -a 256 "$DIR/$prog" | awk '{print $1}')"
  if [ "$got" != "$want" ]; then
    echo "CHECKSUM MISMATCH for $prog: got $got, want $want" >&2
    echo "(upstream may have rolled the build — verify and update the pin)" >&2
    exit 1
  fi
  chmod +x "$DIR/$prog"
  echo "  ok ($got)"
done

echo "BLUPF90 binaries ready in $DIR"
