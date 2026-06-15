// Genomic bridge for the tomato corpus (ADR-0017): turn the plain marker CSV (data/tomato/markers.csv,
// genotype × 200 dosage 0/1/2) into the packed dosage the generic genomic kernel expects, then run
// genomic-analyze.R (rrBLUP) to produce the GRM + CV (identity vs genomic_G) + GEBVs + PCA + heatmap —
// everything the Genomics tab renders, and the genomic_G GEBVs the selection index can rank on when the
// breeder chooses relationship = G. The G2F path reads markers from Postgres; tomato's are a flat CSV
// with full overlap to the trial genotypes (incl. the 6 checks) and no pedigree.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse } from 'csv-parse/sync';
import { tomatoCorpusDir } from './paths';
import { runRKernel } from './kernel';
import { genomicGblup } from './genomic-blupf90';

let _markers: { byId: Map<string, number[]>; nMarkers: number } | null = null;
function loadMarkers() {
  if (_markers) return _markers;
  const rows = parse(readFileSync(join(tomatoCorpusDir(), 'markers.csv')), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
  const cols = Object.keys(rows[0] ?? {}).filter((c) => c !== 'genotype');
  const byId = new Map<string, number[]>();
  for (const r of rows) byId.set(r.genotype, cols.map((c) => Number(r[c])));
  return (_markers = { byId, nMarkers: cols.length });
}

/** Marker readiness for a cut's cohort (the planner needs this to offer relationship=G and the genomic
 *  engine choice). No pedigree in the tomato corpus, so A/H stay locked; markers + overlap drive G. */
export function markerReadiness(cohort: string[]): { markers_present: boolean; pedigree_present: boolean; n_genotyped: number } {
  const mk = loadMarkers();
  const n = cohort.filter((id) => mk.byId.has(id)).length;
  return { markers_present: n >= 10 && mk.nMarkers > 0, pedigree_present: false, n_genotyped: n };
}

export interface GenomicBuildInput {
  cohort: string[]; // genotype ids in the cut (BLUP order)
  traits: string[];
  phenoByTrait: Record<string, Array<number | null>>; // per-trait values aligned to `cohort` (the cut BLUPs)
  /** When 'blupf90' and the (co)variances are supplied, also fit native BLUPF90/preGSf90 GBLUP and
   *  attach gebv_blupf90 so the index can re-point onto it (the engine = BLUPF90 choice). */
  engine?: 'rrblup' | 'blupf90' | null;
  geneticCovariance?: number[][];
  residualCovariance?: number[][];
}

/** Build the bundle.genomic block from markers.csv for the cut's cohort. Returns null when too few
 *  genotyped lines for a meaningful GRM. Best-effort: caller wraps in try/catch. */
export function buildGenomicBlock(input: GenomicBuildInput): Record<string, unknown> | null {
  const mk = loadMarkers();
  const cohort = input.cohort.filter((id) => mk.byId.has(id));
  if (cohort.length < 10 || mk.nMarkers < 1) return null;
  const m = mk.nMarkers;
  const MISSING = 9; // sim dosages are always 0/1/2, so this sentinel never occurs
  const buf = Buffer.alloc(cohort.length * m);
  cohort.forEach((id, i) => {
    const d = mk.byId.get(id)!;
    for (let j = 0; j < m; j++) { const v = d[j]; buf[i * m + j] = v == null || !Number.isFinite(v) ? MISSING : v; }
  });
  const binPath = join(tmpdir(), 'verdant-tomato.geno.bin');
  const metaPath = join(tmpdir(), 'verdant-tomato.geno.meta.json');
  writeFileSync(binPath, buf);
  writeFileSync(metaPath, JSON.stringify({ samples: cohort, nMarkers: m, missing: MISSING }));

  const phenoTraits: Record<string, Array<number | null>> = {};
  for (const tr of input.traits) phenoTraits[tr] = input.phenoByTrait[tr] ?? cohort.map(() => null);

  const out = runRKernel<Record<string, unknown>>('genomic-analyze.R', {
    bin: binPath, meta: metaPath,
    pedigree: { id: cohort, sire: cohort.map(() => '0'), dam: cohort.map(() => '0') }, // no pedigree
    pheno: { names: cohort, traits: phenoTraits },
    folds: 5, reps: 2, heatmap_n: 100,
  }, { transport: 'cfg-file' });

  // Native BLUPF90/preGSf90 GBLUP — only when the breeder chose engine = BLUPF90 (it needs the docker
  // image + a few minutes; rrBLUP above is the fast default). The GEBVs are cross-engine validated to
  // match rrBLUP; the index re-points onto gebv_blupf90 when present. Best-effort: failure leaves rrBLUP.
  if (input.engine === 'blupf90' && input.geneticCovariance && input.residualCovariance) {
    try {
      const snpPath = join(tmpdir(), 'verdant-tomato.snp.txt');
      const idW = Math.max(1, ...cohort.map((s) => s.length));
      const lines = cohort.map((id, i) => {
        let s = id.padEnd(idW) + ' ';
        for (let j = 0; j < m; j++) { const v = buf[i * m + j]; s += v === MISSING ? '5' : String(v); }
        return s;
      });
      writeFileSync(snpPath, lines.join('\n') + '\n');
      const nat = genomicGblup({
        ids: cohort, traits: input.traits, phenoByTrait: phenoTraits,
        snpPath, geneticCovariance: input.geneticCovariance, residualCovariance: input.residualCovariance,
      });
      (out as Record<string, unknown>).gebv_blupf90 = Object.fromEntries(input.traits.map((tr) => {
        const map = new Map(nat.gebvByTrait[tr].map((x) => [x.id, x.gebv]));
        return [tr, { values: cohort.map((id) => map.get(id) ?? 0) }];
      }));
    } catch (e) {
      console.log(`native BLUPF90 GBLUP skipped: ${(e as Error).message}`);
    }
  }

  return { ...out, cohort, cohort_n: cohort.length, n_markers: m, traits: input.traits };
}
