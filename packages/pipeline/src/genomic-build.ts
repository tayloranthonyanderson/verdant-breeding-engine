// Genomic build: compute the genomic block (CV model comparison, PCA, GEBVs+reliability, GRM heatmap,
// distribution) for the MET cohort and merge it into the latest result bundle so the GUI shows the
// phenotypic + genomic story together. The cohort view comes from buildGenomicInputs; buildGenomicBlock()
// is importable (this is the production genomic path), the CLI shell prints. Run:
//   corepack pnpm --filter @verdant/pipeline exec tsx src/genomic-build.ts
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { desc, eq } from 'drizzle-orm';
import { db, resultBundle } from '@verdant/db';
import { validateResultBundle, type ResultBundle } from '@verdant/contracts';
import { runRKernel } from './kernel';
import { buildGenomicInputs } from './genomic-inputs';
import { isEntrypoint } from './entry';

const TRAITS = ['Plant_Height_cm', 'Ear_Height_cm', 'Yield_Mg_ha', 'Grain_Moisture'];

interface GenomicBlock {
  cohort_n: number;
  n_markers: number;
  pca: { var_explained: number[] };
  model_comparison: Array<{ trait: string; model: string; predictive_ability: number }>;
  traits?: string[];
  [k: string]: unknown;
}

/** Compute the genomic block and merge it into the latest result bundle (re-validated). */
export async function buildGenomicBlock(): Promise<{ bundleId: number; genomic: GenomicBlock }> {
  const bin = join(tmpdir(), 'verdant-gbuild.bin');
  const meta = join(tmpdir(), 'verdant-gbuild.meta.json');
  console.log('exporting dosages ...');
  const cohort = await buildGenomicInputs({ traits: TRAITS, binPath: bin, metaPath: meta, mafMin: 0.05, maxMarkers: 50000 });
  const hybrids = cohort.matched;

  console.log(`genomic-analyze: ${hybrids.length} hybrids × ${cohort.export.nMarkers} markers ...`);
  const genomic = runRKernel<GenomicBlock>(
    'genomic-analyze.R',
    {
      bin,
      meta,
      pedigree: cohort.pedigree(),
      pheno: { names: hybrids, traits: cohort.phenoByTrait() },
      folds: 5,
      reps: 2,
      heatmap_n: 100,
    },
    { transport: 'cfg-file' },
  );
  genomic.traits = TRAITS; // label order for the UI

  // merge into the latest bundle + re-validate + persist
  const [latest] = await db.select().from(resultBundle).orderBy(desc(resultBundle.id)).limit(1);
  if (!latest) throw new Error('no result bundle to augment — run met-build first');
  const merged = { ...(latest.bundle as ResultBundle), genomic } as ResultBundle;
  const validated = validateResultBundle(merged);
  await db.update(resultBundle).set({ bundle: validated }).where(eq(resultBundle.id, latest.id));
  return { bundleId: latest.id, genomic };
}

async function cli() {
  const { bundleId, genomic } = await buildGenomicBlock();
  const cmp = genomic.model_comparison;
  console.log(`merged genomic block into bundle ${bundleId}`);
  console.log(`  cohort ${genomic.cohort_n} × ${genomic.n_markers} markers; PCA var ${genomic.pca.var_explained.slice(0, 3).join('/')}`);
  for (const tr of TRAITS) {
    const g = cmp.find((x) => x.trait === tr && x.model === 'genomic_G')!.predictive_ability;
    const a = cmp.find((x) => x.trait === tr && x.model === 'pedigree_A')!.predictive_ability;
    console.log(`  ${tr.padEnd(18)} G=${g} A=${a}`);
  }
  await db.$client.end();
}

if (isEntrypoint(import.meta.url)) cli().catch((e) => { console.error(e); process.exit(1); });
