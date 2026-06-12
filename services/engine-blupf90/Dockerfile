# BLUPF90 multi-trait variance-component / genomic engine (ADR-0014).
# Native linux/amd64 — matches production; on the Apple-Silicon dev box this runs inside the
# x86_64 colima VM. Binaries are vendored into bin/ by fetch-binaries.sh (UGA, research-use
# license; commercial use needs a UGA agreement — gate before shipping, ADR-0014).
FROM --platform=linux/amd64 debian:bookworm-slim

# BLUPF90 binaries are dynamically linked against the gfortran runtime.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgfortran5 libquadmath0 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY bin/ /opt/blupf90/
RUN chmod +x /opt/blupf90/*

ENV PATH="/opt/blupf90:${PATH}"
WORKDIR /work
