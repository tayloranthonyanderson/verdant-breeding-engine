-- Marker-gate source: homozygous allele per major-gene locus on each inbred (ADR-0020).
ALTER TABLE "inbred_line" ADD COLUMN IF NOT EXISTS "loci" jsonb;
