// ssGBLUP demonstration: can single-step predict the un-genotyped MET hybrids (no markers) via the
// pedigree link to genotyped relatives? The cohort view comes from buildGenomicInputs with the full
// phenotyped set (so the pedigree spans un-genotyped lines); runSsGblup() is importable, the CLI
// shell prints + writes the report JSON. Run:
//   corepack pnpm --filter @verdant/pipeline exec tsx src/ssgblup-run.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { db } from '@verdant/db';
import { runRKernel } from './kernel';
import { buildGenomicInputs } from './genomic-inputs';
import { isEntrypoint } from './entry';

export interface SsGblupResult {
  n_genotyped: number;
  n_ungenotyped: number;
  ungenotyped_predictive_ability: { single_step_H: number | null; pedigree_A: number | null; n_test: number };
  note: string;
}

/** ssGBLUP: predict the un-genotyped phenotyped MET hybrids via the pedigree link to genotyped kin. */
export async function runSsGblup(): Promise<SsGblupResult> {
  const bin = join(tmpdir(), 'verdant-ss.bin');
  const meta = join(tmpdir(), 'verdant-ss.meta.json');
  const cohort = await buildGenomicInputs({
    traits: ['Yield_Mg_ha'],
    binPath: bin,
    metaPath: meta,
    mafMin: 0.05,
    maxMarkers: 50000,
    requirePhenotyped: true,
  });
  const allHybrids = cohort.genotypes; // all phenotyped (genotyped + un-genotyped)
  const genotyped = cohort.matched;
  console.log(`all phenotyped: ${allHybrids.length}; genotyped: ${genotyped.length}; un-genotyped: ${allHybrids.length - genotyped.length}`);

  return runRKernel<SsGblupResult>(
    'genomic-ssgblup.R',
    {
      bin,
      meta,
      pedigree: cohort.pedigree(allHybrids),
      pheno: { names: allHybrids, y: cohort.phenoByTrait(allHybrids)['Yield_Mg_ha'] },
      genotyped,
    },
    { transport: 'cfg-file' },
  );
}

async function cli() {
  const out = await runSsGblup();
  console.log('\n=== ssGBLUP: predicting un-genotyped hybrids (no markers) ===');
  console.log(`  test lines: ${out.ungenotyped_predictive_ability.n_test} (un-genotyped, have phenotype)`);
  console.log(`  single-step H predictive ability: ${out.ungenotyped_predictive_ability.single_step_H}`);
  console.log(`  pedigree-only A predictive ability: ${out.ungenotyped_predictive_ability.pedigree_A}`);
  console.log(`  genomic-only G: cannot predict them (no markers)`);
  writeFileSync(join(tmpdir(), 'verdant-ss-results.json'), JSON.stringify(out, null, 2));
  await db.$client.end();
}

if (isEntrypoint(import.meta.url)) cli().catch((e) => { console.error(e); process.exit(1); });
