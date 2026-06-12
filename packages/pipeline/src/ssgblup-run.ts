// ssGBLUP demonstration: can single-step predict the un-genotyped MET hybrids (no markers) via the
// pedigree link to genotyped relatives? Run:
//   corepack pnpm --filter @verdant/pipeline exec tsx src/ssgblup-run.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { exportCohortDosages } from './grm';
import { db } from '@verdant/db';

async function main() {
  const csv = resolve(import.meta.dirname, '../../../data/g2f/MET_2019.csv');
  const lines = readFileSync(csv, 'utf8').trim().split('\n');
  const h = lines[0].split(','); const c = (k: string) => h.indexOf(k);
  const GENO = c('Hybrid'), P1 = c('Hybrid_Parent1'), P2 = c('Hybrid_Parent2'), Y = c('Yield_Mg_ha');
  const acc = new Map<string, { s: number; n: number; p1: string; p2: string }>();
  for (const l of lines.slice(1)) {
    const f = l.split(','); let a = acc.get(f[GENO]);
    if (!a) { a = { s: 0, n: 0, p1: f[P1], p2: f[P2] }; acc.set(f[GENO], a); }
    const v = f[Y]; if (v !== 'NA' && v !== '') { const x = Number(v); if (Number.isFinite(x)) { a.s += x; a.n += 1; } }
  }
  const allHybrids = [...acc.keys()].filter((g) => acc.get(g)!.n > 0);

  const bin = join(tmpdir(), 'verdant-ss.bin'); const meta = join(tmpdir(), 'verdant-ss.meta.json');
  const exp = await exportCohortDosages(allHybrids, bin, meta, { mafMin: 0.05, maxMarkers: 50000 });
  const genotyped = exp.matched;
  const parents = [...new Set(allHybrids.flatMap((g) => [acc.get(g)!.p1, acc.get(g)!.p2]))].filter(Boolean);
  const cfg = join(tmpdir(), 'verdant-ss.cfg.json');
  writeFileSync(cfg, JSON.stringify({
    bin, meta,
    pedigree: { id: [...parents, ...allHybrids], sire: [...parents.map(() => '0'), ...allHybrids.map((g) => acc.get(g)!.p1)], dam: [...parents.map(() => '0'), ...allHybrids.map((g) => acc.get(g)!.p2)] },
    pheno: { names: allHybrids, y: allHybrids.map((g) => { const a = acc.get(g)!; return a.s / a.n; }) },
    genotyped,
  }));
  console.log(`all phenotyped: ${allHybrids.length}; genotyped: ${genotyped.length}; un-genotyped: ${allHybrids.length - genotyped.length}`);

  const script = resolve(import.meta.dirname, '../../../services/kernel/genomic-ssgblup.R');
  const proc = spawnSync('Rscript', [script, cfg], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (proc.status !== 0) throw new Error(`genomic-ssgblup.R failed:\n${proc.stderr}`);
  const out = JSON.parse(proc.stdout);
  console.log('\n=== ssGBLUP: predicting un-genotyped hybrids (no markers) ===');
  console.log(`  test lines: ${out.ungenotyped_predictive_ability.n_test} (un-genotyped, have phenotype)`);
  console.log(`  single-step H predictive ability: ${out.ungenotyped_predictive_ability.single_step_H}`);
  console.log(`  pedigree-only A predictive ability: ${out.ungenotyped_predictive_ability.pedigree_A}`);
  console.log(`  genomic-only G: cannot predict them (no markers)`);
  writeFileSync(join(tmpdir(), 'verdant-ss-results.json'), JSON.stringify(out, null, 2));
  await db.$client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
