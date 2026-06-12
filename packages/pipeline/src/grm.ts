// Genomic relationship inputs: decode packed CallSets (ADR-0017) into a dosage matrix for a cohort,
// QC-filter by the stored MAF, thin to a manageable marker count for the in-memory (rrBLUP) G build,
// and write a compact binary the relationship.R kernel reads. The full-marker G is built natively by
// preGSf90 (streamed) — this path is for the rrBLUP cross-validation engine and quick G estimates.
import { writeFileSync, openSync, writeSync, closeSync } from 'node:fs';
import { eq, gte, inArray, asc, and } from 'drizzle-orm';
import { db, variantSet, variant, sample, callSet } from '@verdant/db';

const MISSING = 255;

export interface DosageExport {
  binPath: string; // Uint8 row-major, nSamples × nMarkers (255 = missing)
  metaPath: string; // JSON sidecar: samples, marker idx/name/chrom/pos/maf, dims
  nSamples: number;
  nMarkers: number;
  matched: string[]; // cohort names that had a CallSet
  snpPath?: string; // BLUPF90 SNP text file (id + 0/1/2/5 string), when requested
}

/** Evenly thin a sorted index list to at most `max` entries (keeps genome-wide spread). */
function thin<T>(xs: T[], max: number): T[] {
  if (xs.length <= max) return xs;
  const step = xs.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(xs[Math.floor(i * step)]);
  return out;
}

/** Export a cohort's dosage matrix (QC-filtered + thinned) to a binary + meta sidecar for R. */
export async function exportCohortDosages(
  cohortNames: string[],
  binPath: string,
  metaPath: string,
  opts: { setName?: string; mafMin?: number; maxMarkers?: number; snpPath?: string } = {},
): Promise<DosageExport> {
  const mafMin = opts.mafMin ?? 0.05;
  const maxMarkers = opts.maxMarkers ?? 50000;

  const vs = opts.setName
    ? await db.select().from(variantSet).where(eq(variantSet.name, opts.setName))
    : await db.select().from(variantSet);
  if (!vs.length) throw new Error('no variant_set found');
  const setId = vs[0].id;

  // QC-pass markers (MAF ≥ threshold), in genome order, thinned to maxMarkers.
  const vrows = await db
    .select({ idx: variant.idx, name: variant.name, chrom: variant.chrom, pos: variant.pos, maf: variant.maf })
    .from(variant)
    .where(and(eq(variant.variantSetId, setId), gte(variant.maf, mafMin)))
    .orderBy(asc(variant.idx));
  const markers = thin(vrows, maxMarkers);
  const sel = markers.map((m) => m.idx); // selected byte offsets into the packed dosage vector
  const nMarkers = sel.length;

  // Cohort CallSets, decoded at the selected offsets, streamed to the binary (sample-major). When
  // snpPath is set, also write a BLUPF90 SNP text file (id + 0/1/2 string, missing→5) for preGSf90.
  const fd = openSync(binPath, 'w');
  const snpFd = opts.snpPath ? openSync(opts.snpPath, 'w') : null;
  // preGSf90 needs a FIXED-WIDTH SNP file: the genotype string must start at the same column on every
  // line, so pad each id to a constant width (max over the cohort) before the genotype string.
  const idWidth = snpFd !== null ? Math.max(1, ...cohortNames.map((s) => s.length)) : 0;
  const matched: string[] = [];
  const BATCH = 100;
  for (let i = 0; i < cohortNames.length; i += BATCH) {
    const names = cohortNames.slice(i, i + BATCH);
    const rows = await db
      .select({ name: sample.name, dosages: callSet.dosages })
      .from(callSet)
      .innerJoin(sample, eq(callSet.sampleId, sample.id))
      .where(and(eq(callSet.variantSetId, setId), inArray(sample.name, names)));
    // preserve cohort order within the batch
    const byName = new Map(rows.map((r) => [r.name, r.dosages as Buffer]));
    for (const name of names) {
      const buf = byName.get(name);
      if (!buf) continue;
      const out = Buffer.allocUnsafe(nMarkers);
      for (let j = 0; j < nMarkers; j++) out[j] = buf[sel[j]];
      writeSync(fd, out);
      if (snpFd !== null) {
        let s = name.padEnd(idWidth) + ' ';
        for (let j = 0; j < nMarkers; j++) s += out[j] === MISSING ? '5' : String(out[j]);
        writeSync(snpFd, s + '\n');
      }
      matched.push(name);
    }
  }
  closeSync(fd);
  if (snpFd !== null) closeSync(snpFd);

  writeFileSync(
    metaPath,
    JSON.stringify({
      nSamples: matched.length,
      nMarkers,
      missing: MISSING,
      samples: matched,
      markerIdx: sel,
      markerName: markers.map((m) => m.name),
      chrom: markers.map((m) => m.chrom),
      pos: markers.map((m) => m.pos),
      maf: markers.map((m) => m.maf),
    }),
  );

  return { binPath, metaPath, nSamples: matched.length, nMarkers, matched, snpPath: opts.snpPath };
}
