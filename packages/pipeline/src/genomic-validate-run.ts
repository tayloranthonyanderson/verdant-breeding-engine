// Objective validation: does relationship information add value? Cross-validate identity vs pedigree
// (A) vs genomic (G) on the MET cohort, per trait. Run:
//   corepack pnpm --filter @verdant/pipeline exec tsx src/genomic-validate-run.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { exportCohortDosages } from './grm';
import { db } from '@verdant/db';

const TRAITS = ['Plant_Height_cm', 'Ear_Height_cm', 'Yield_Mg_ha', 'Grain_Moisture'];

async function main() {
  const csv = resolve(import.meta.dirname, '../../../data/g2f/MET_2019.csv');
  const lines = readFileSync(csv, 'utf8').trim().split('\n');
  const h = lines[0].split(',');
  const c = (k: string) => h.indexOf(k);
  const GENO = c('Hybrid'), P1 = c('Hybrid_Parent1'), P2 = c('Hybrid_Parent2');
  const ix = TRAITS.map(c);

  // per-hybrid trait means + parentage
  const acc = new Map<string, { sum: number[]; n: number[]; p1: string; p2: string }>();
  for (const l of lines.slice(1)) {
    const f = l.split(',');
    const g = f[GENO];
    let a = acc.get(g);
    if (!a) { a = { sum: TRAITS.map(() => 0), n: TRAITS.map(() => 0), p1: f[P1], p2: f[P2] }; acc.set(g, a); }
    ix.forEach((col, t) => { const v = f[col]; if (v !== 'NA' && v !== '') { const x = Number(v); if (Number.isFinite(x)) { a!.sum[t] += x; a!.n[t] += 1; } } });
  }
  const cohort = [...acc.keys()];
  console.log(`MET: ${cohort.length} hybrids`);

  // dosages (G)
  const bin = join(tmpdir(), 'verdant-val.bin');
  const meta = join(tmpdir(), 'verdant-val.meta.json');
  console.log('exporting dosages (MAF≥0.05, ≤50k) ...');
  const exp = await exportCohortDosages(cohort, bin, meta, { mafMin: 0.05, maxMarkers: 50000 });
  console.log(`genotyped cohort: ${exp.nSamples} hybrids × ${exp.nMarkers} markers`);

  // pedigree: parents as founders, then the genotyped hybrids
  const hybrids = exp.matched;
  const parents = [...new Set(hybrids.flatMap((g) => [acc.get(g)!.p1, acc.get(g)!.p2]))].filter(Boolean);
  const pedId = [...parents, ...hybrids];
  const pedSire = [...parents.map(() => '0'), ...hybrids.map((g) => acc.get(g)!.p1)];
  const pedDam = [...parents.map(() => '0'), ...hybrids.map((g) => acc.get(g)!.p2)];

  // phenotypes per trait (per-hybrid means)
  const mean = (g: string, t: number) => { const a = acc.get(g)!; return a.n[t] ? a.sum[t] / a.n[t] : null; };
  const traits: Record<string, (number | null)[]> = {};
  TRAITS.forEach((tr, t) => { traits[tr] = hybrids.map((g) => mean(g, t)); });

  const cfg = join(tmpdir(), 'verdant-val.cfg.json');
  writeFileSync(cfg, JSON.stringify({
    bin, meta,
    pedigree: { id: pedId, sire: pedSire, dam: pedDam },
    pheno: { names: hybrids, traits },
    folds: 5, reps: 2,
  }));

  console.log(`pedigree: ${parents.length} parents + ${hybrids.length} hybrids; running 5-fold × 2-rep CV (identity/A/G × ${TRAITS.length} traits) ...`);
  const script = resolve(import.meta.dirname, '../../../services/kernel/genomic-validate.R');
  const proc = spawnSync('Rscript', [script, cfg], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (proc.status !== 0) throw new Error(`genomic-validate.R failed:\n${proc.stderr}`);
  const out = JSON.parse(proc.stdout) as {
    results: Array<{ trait: string; model: string; predictive_ability: number; bias: number; dispersion: number; n_test: number }>;
  };

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
  // machine-readable for the report
  writeFileSync(join(tmpdir(), 'verdant-val-results.json'), JSON.stringify(out, null, 2));
  console.log(`\nresults JSON: ${join(tmpdir(), 'verdant-val-results.json')}`);
  await db.$client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
