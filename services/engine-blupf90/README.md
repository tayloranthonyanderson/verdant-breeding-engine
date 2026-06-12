# BLUPF90 engine — multi-trait variance components & genomic

Per [ADR-0014](../../docs/adr/0014-scale-first-engine-selection.md), BLUPF90 (UGA, Misztal lab) is
Verdant's engine for **multi-trait variance components** (genetic correlations / the **G** matrix for
the Smith–Hazel index) and large **single-step genomic** evaluation. It runs as a native
`linux/amd64` subprocess inside this container — matching production. On the Apple-Silicon dev box it
runs in an x86_64 `colima` VM (BLUPF90 ships no ARM build).

## Programs (vendored in `bin/`, gitignored)
- **`blupf90+`** — unified BLUP / REML / AI-REML; multi-trait variance components.
- **`renumf90`** — renumbering / preprocessing of data + parameter files.

## Setup
```sh
./fetch-binaries.sh                                  # download into bin/ (checksum-verified)
docker build --platform linux/amd64 -t verdant-blupf90 .
docker run --rm verdant-blupf90 sh -lc 'echo | blupf90+ | head'   # smoke test: prints the banner
```

## Licensing
Binaries come from UGA (http://nce.ads.uga.edu). **Free for research/academic use; commercial use
requires a license agreement with UGA** — gate before shipping (ADR-0014). The binaries are **not**
committed; `fetch-binaries.sh` retrieves them and verifies pinned SHA-256 sums. A checksum failure
means upstream rolled the build — review and update the pin deliberately.
