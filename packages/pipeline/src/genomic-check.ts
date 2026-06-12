// Genomic foundation smoke + validation driver: build G for the MET cohort and run rrBLUP GBLUP.
// Phenotype = per-hybrid mean yield from the MET (any consistent per-hybrid value works for the G
// sanity + GBLUP slice). Run: corepack pnpm --filter @verdant/pipeline exec tsx src/genomic-check.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportCohortDosages } from './grm';
import { db } from '@verdant/db';

async function main() {
  // MET hybrids + per-hybrid mean yield (the phenotype for this single-trait slice)
  const csv = resolve(import.meta.dirname, '../../../data/g2f/MET_2019.csv');
  const lines = readFileSync(csv, 'utf8').trim().split('\n');
  const h = lines[0].split(',');
  const GENO = h.indexOf('Hybrid'), Y = h.indexOf('Yield_Mg_ha');
  const sum = new Map<string, { s: number; n: number }>();
  for (const l of lines.slice(1)) {
    const f = l.split(',');
    const v = f[Y] === 'NA' || f[Y] === '' ? null : Number(f[Y]);
    if (v == null || !Number.isFinite(v)) continue;
    const a = sum.get(f[GENO]) ?? { s: 0, n: 0 };
    a.s += v; a.n += 1; sum.set(f[GENO], a);
  }
  const cohort = [...sum.keys()];
  console.log(`MET cohort: ${cohort.length} hybrids with yield`);

  const bin = join(tmpdir(), 'verdant-dosage.bin');
  const meta = join(tmpdir(), 'verdant-dosage.meta.json');
  console.log('exporting dosages (MAF≥0.05, ≤50k markers) ...');
  const exp = await exportCohortDosages(cohort, bin, meta, { mafMin: 0.05, maxMarkers: 50000 });
  console.log(`genotyped: ${exp.nSamples}/${cohort.length} hybrids × ${exp.nMarkers} markers`);

  const pheno = {
    names: exp.matched,
    y: exp.matched.map((n) => { const a = sum.get(n)!; return a.s / a.n; }),
  };
  const cfg = join(tmpdir(), 'verdant-rel.cfg.json');
  writeFileSync(cfg, JSON.stringify({ bin, meta, pheno }));

  console.log('building G + rrBLUP GBLUP ...');
  const script = resolve(import.meta.dirname, '../../../services/kernel/relationship.R');
  const proc = spawnSync('Rscript', [script, cfg], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (proc.status !== 0) throw new Error(`relationship.R failed:\n${proc.stderr}`);
  const out = JSON.parse(proc.stdout) as {
    sanity: Record<string, number | boolean>;
    gblup?: { Vg: number; Ve: number; h2_genomic: number; n_trained: number; gebv: Array<{ id: string; gebv: number }> };
  };

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

main().catch((e) => { console.error(e); process.exit(1); });
