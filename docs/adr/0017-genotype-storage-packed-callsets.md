# ADR-0017 — Genotype storage: BrAPI metadata + packed CallSet dosages (long `call` is the contract)

**Status:** Accepted (2026-06-11)

## Context
Genomic prediction (GBLUP / rrBLUP, ADR-0014) needs the genotype matrix — lines × markers. The first
real panel is the G2F competition VCF: ~437k SNPs × ~4,928 hybrids (8.6 GB uncompressed VCF). The
toolkit must serve many crops and platforms (different marker sets, array vs GBS vs sequence), and is
destined for a BigQuery warehouse, while running on Postgres today.

The schema's [domain model](../../packages/db/src/schema.ts) already mapped BrAPI genotyping objects
(Variant / CallSet / Sample / Call) and anticipated the **long `call` table** ("billions of rows at
M6"). That long form is BrAPI-faithful, handles platform heterogeneity without invariants, and is
BigQuery-native — but materialized in Postgres it is hundreds of millions of rows now (tens of GB,
slow bulk reads) for data that genomic prediction always consumes as a whole matrix, never per-call.

## Decision
**Separate the *contract* from the *physical encoding*.**

- **The crop/platform heterogeneity axis is the `VariantSet`**, not the storage format. Each panel /
  platform / build is its own VariantSet (a maize 437k hybrid VCF, a tomato GBS run, an Illumina
  array all coexist). A `Variant.idx` fixes each marker's ordinal position within its set; a
  `CallSet` belongs to one VariantSet. Adding a crop/platform = adding a VariantSet, no schema change.
- **The canonical, portable model is the BrAPI long form** (VariantSet / Variant / Sample / CallSet /
  Call). It is the contract and the **BigQuery physical schema** (columnar, where long is efficient).
- **In the Postgres tier, store dosages PACKED on the CallSet**: one `bytea` per CallSet, one byte per
  variant (0/1/2; 255 = missing), ordered by `variant.idx`, LZ4/TOAST-compressed. Compact and fast to
  bulk-load. The long `call` form is a **derivable view/export** over these blobs, not a stored table.
- Packed is therefore a **swappable physical-storage layer**. At BigQuery migration the long form
  becomes the physical store and the PG blob is dropped — a mechanical unpack, no model change.

Genotype encoding (GT → dosage) and per-marker QC (MAF, call-rate) are computed at ingest; missing =
255. Hybrids are genotyped directly here, so no midparent derivation is needed (when only parental
genotypes exist, a hybrid dosage is the midparent — done in the compute layer, not stored).

## Consequences
- Tables: `variant_set`, `variant`, `sample`, `call_set` (packed `dosages bytea`). The compute engine
  (BLUPF90 ssGBLUP / rrBLUP) reads the packed matrix directly — one blob read per line builds Z, then
  G = ZZ′/k (VanRaden). `sample.germplasm_id` links genotype to the phenotype/germplasm identity.
- Cross-set integration (combining platforms) is a **compute step** (harmonization/imputation
  producing a new VariantSet), independent of storage — packed loses nothing real there; the
  cross-set analytics it is weak at is exactly BigQuery's job.
- Postgres stays small (a few hundred MB compressed for this panel) instead of tens of GB of dense
  rows; the heavy warehouse-scale long form lives in BigQuery where it belongs.

## Alternatives rejected
- **Materialize the BrAPI long `call` table in Postgres** — faithful and BigQuery-native, but
  150M+ rows now / billions later, tens of GB, slow whole-matrix reads, for an access pattern that is
  always bulk. Reserved as the contract/view and the BigQuery target, not the PG physical store.
- **PLINK `.bed` file + metadata-only DB** — most genomics-idiomatic and smallest (2-bit), engines
  read it natively; rejected because it puts the values in a file rather than "in the tables," and the
  packed-bytea CallSet gets ~the same compactness while keeping genotypes queryable through the model.
- **Packed as the only model (no long contract)** — would lock the platform into an encoding and lose
  the heterogeneity/warehouse flexibility. Packed is deliberately scoped as a physical layer under the
  long contract.
