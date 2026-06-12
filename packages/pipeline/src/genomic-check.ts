// Genomic foundation smoke + validation: build G for the genotyped MET cohort and run rrBLUP GBLUP
// on per-hybrid mean yield (any consistent per-hybrid value works for the G sanity + GBLUP slice).
// The cohort view comes from buildGenomicInputs; checkRelationship() is importable, the CLI shell
// prints. Run: corepack pnpm --filter @verdant/pipeline exec tsx src/genomic-check.ts
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { db } from '@verdant/db';
import { runRKernel } from './kernel';
import { buildGenomicInputs } from './genomic-inputs';
import { isEntrypoint } from './entry';

export interface RelationshipResult {
  samples: string[];
  sanity: Record<string, number | boolean>;
  gblup?: {
    Vg: number;
    Ve: number;
    h2_genomic: number;
    n_trained: number;
    gebv: Array<{ id: string; gebv: number }>;
  };
}

/** Build G for the genotyped MET cohort and fit rrBLUP GBLUP on per-hybrid mean yield. */
export async function checkRelationship(): Promise<RelationshipResult> {
  const bin = join(tmpdir(), 'verdant-dosage.bin');
  const meta = join(tmpdir(), 'verdant-dosage.meta.json');
  console.log('exporting dosages (MAF≥0.05, ≤50k markers) ...');
  const cohort = await buildGenomicInputs({
    traits: ['Yield_Mg_ha'],
    binPath: bin,
    metaPath: meta,
    requirePhenotyped: true,
  });
  console.log(`MET cohort: ${cohort.hybrids.length} hybrids with yield`);
  console.log(`genotyped: ${cohort.matched.length}/${cohort.hybrids.length} hybrids × ${cohort.export.nMarkers} markers`);

  console.log('building G + rrBLUP GBLUP ...');
  const pheno = { names: cohort.matched, y: cohort.phenoByTrait()['Yield_Mg_ha'] };
  return runRKernel<RelationshipResult>('relationship.R', { bin, meta, pheno }, { transport: 'cfg-file' });
}

async function cli() {
  const out = await checkRelationship();
  console.log('\n=== G sanity ===');
  for (const [k, v] of Object.entries(out.sanity)) console.log(`  ${k.padEnd(18)} ${v}`);
  if (out.gblup) {
    console.log('\n=== rrBLUP GBLUP (yield) ===');
    console.log(`  trained on ${out.gblup.n_trained}; Vg=${out.gblup.Vg} Ve=${out.gblup.Ve} h²_genomic=${out.gblup.h2_genomic}`);
    const top = [...out.gblup.gebv].sort((a, b) => b.gebv - a.gebv).slice(0, 5);
    console.log('  top-5 GEBV:', top.map((g) => `${g.id}=${g.gebv}`).join('  '));
  }
  await db.$client.end();
}

if (isEntrypoint(import.meta.url)) cli().catch((e) => { console.error(e); process.exit(1); });
