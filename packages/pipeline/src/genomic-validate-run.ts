// Objective validation: does relationship information add value? Cross-validate identity vs pedigree
// (A) vs genomic (G) on the MET cohort, per trait. The cohort view comes from buildGenomicInputs;
// crossValidateRelationships() is importable (the "Cross-validate this cohort" flow the UI will
// trigger), the CLI shell prints + writes the report JSON. Run:
//   corepack pnpm --filter @verdant/pipeline exec tsx src/genomic-validate-run.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { db } from '@verdant/db';
import { runRKernel } from './kernel';
import { buildGenomicInputs } from './genomic-inputs';
import { isEntrypoint } from './entry';

const TRAITS = ['Plant_Height_cm', 'Ear_Height_cm', 'Yield_Mg_ha', 'Grain_Moisture'];

export interface ValidationResult {
  cohort_n: number;
  n_markers: number;
  folds: number;
  reps: number;
  traits: string[];
  results: Array<{
    trait: string;
    model: string;
    predictive_ability: number;
    bias: number;
    dispersion: number;
    n_test: number;
  }>;
}

/** Cross-validate identity vs pedigree (A) vs genomic (G) on the MET cohort, per trait. */
export async function crossValidateRelationships(): Promise<ValidationResult> {
  const bin = join(tmpdir(), 'verdant-val.bin');
  const meta = join(tmpdir(), 'verdant-val.meta.json');
  console.log('exporting dosages (MAF≥0.05, ≤50k) ...');
  const cohort = await buildGenomicInputs({ traits: TRAITS, binPath: bin, metaPath: meta, mafMin: 0.05, maxMarkers: 50000 });
  console.log(`cohort: ${cohort.genotypes.length} genotypes`);
  const hybrids = cohort.matched;
  console.log(`genotyped cohort: ${cohort.export.nSamples} hybrids × ${cohort.export.nMarkers} markers`);
  console.log(`pedigree: ${cohort.parents().length} parents + ${hybrids.length} hybrids; running 5-fold × 2-rep CV (identity/A/G × ${TRAITS.length} traits) ...`);

  return runRKernel<ValidationResult>(
    'genomic-validate.R',
    {
      bin,
      meta,
      pedigree: cohort.pedigree(),
      pheno: { names: hybrids, traits: cohort.phenoByTrait() },
      folds: 5,
      reps: 2,
    },
    { transport: 'cfg-file' },
  );
}

async function cli() {
  const out = await crossValidateRelationships();
  console.log('\n=== predictive ability (CV correlation predicted vs observed) ===');
  console.log('trait'.padEnd(18) + 'identity   pedigree_A  genomic_G   (G−A gain)');
  for (const tr of TRAITS) {
    const r = (m: string) => out.results.find((x) => x.trait === tr && x.model === m)!;
    const id = r('identity').predictive_ability, a = r('pedigree_A').predictive_ability, g = r('genomic_G').predictive_ability;
    console.log(tr.padEnd(18) + `${id.toFixed(3).padEnd(11)}${a.toFixed(3).padEnd(12)}${g.toFixed(3).padEnd(12)}${(g - a >= 0 ? '+' : '') + (g - a).toFixed(3)}`);
  }
  console.log('\n=== LR calibration (genomic_G): bias≈0, dispersion≈1 = well-calibrated ===');
  for (const tr of TRAITS) {
    const g = out.results.find((x) => x.trait === tr && x.model === 'genomic_G')!;
    console.log(`  ${tr.padEnd(18)} bias=${g.bias}  dispersion=${g.dispersion}  (n=${g.n_test})`);
  }
  writeFileSync(join(tmpdir(), 'verdant-val-results.json'), JSON.stringify(out, null, 2));
  console.log(`\nresults JSON: ${join(tmpdir(), 'verdant-val-results.json')}`);
  await db.$client.end();
}

if (isEntrypoint(import.meta.url)) cli().catch((e) => { console.error(e); process.exit(1); });
