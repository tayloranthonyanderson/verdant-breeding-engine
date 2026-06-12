// Genomic build: compute the genomic block (CV model comparison, PCA, GEBVs+reliability, GRM heatmap,
// distribution) for the MET cohort and merge it into the latest result bundle so the GUI shows the
// phenotypic + genomic story together. Run:
//   corepack pnpm --filter @verdant/pipeline exec tsx src/genomic-build.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { desc, eq } from 'drizzle-orm';
import { db, resultBundle } from '@verdant/db';
import { validateResultBundle, type ResultBundle } from '@verdant/contracts';
import { exportCohortDosages } from './grm';

const TRAITS = ['Plant_Height_cm', 'Ear_Height_cm', 'Yield_Mg_ha', 'Grain_Moisture'];

async function main() {
  // MET per-hybrid trait means + parentage
  const csv = resolve(import.meta.dirname, '../../../data/g2f/MET_2019.csv');
  const lines = readFileSync(csv, 'utf8').trim().split('\n');
  const h = lines[0].split(','); const c = (k: string) => h.indexOf(k);
  const GENO = c('Hybrid'), P1 = c('Hybrid_Parent1'), P2 = c('Hybrid_Parent2'); const ix = TRAITS.map(c);
  const acc = new Map<string, { sum: number[]; n: number[]; p1: string; p2: string }>();
  for (const l of lines.slice(1)) {
    const f = l.split(','); let a = acc.get(f[GENO]);
    if (!a) { a = { sum: TRAITS.map(() => 0), n: TRAITS.map(() => 0), p1: f[P1], p2: f[P2] }; acc.set(f[GENO], a); }
    ix.forEach((col, t) => { const v = f[col]; if (v !== 'NA' && v !== '') { const x = Number(v); if (Number.isFinite(x)) { a!.sum[t] += x; a!.n[t] += 1; } } });
  }
  const cohort = [...acc.keys()];

  const bin = join(tmpdir(), 'verdant-gbuild.bin'); const meta = join(tmpdir(), 'verdant-gbuild.meta.json');
  console.log('exporting dosages ...');
  const exp = await exportCohortDosages(cohort, bin, meta, { mafMin: 0.05, maxMarkers: 50000 });
  const hybrids = exp.matched;
  const parents = [...new Set(hybrids.flatMap((g) => [acc.get(g)!.p1, acc.get(g)!.p2]))].filter(Boolean);
  const mean = (g: string, t: number) => { const a = acc.get(g)!; return a.n[t] ? a.sum[t] / a.n[t] : null; };
  const traits: Record<string, (number | null)[]> = {};
  TRAITS.forEach((tr, t) => { traits[tr] = hybrids.map((g) => mean(g, t)); });
  const cfg = join(tmpdir(), 'verdant-gbuild.cfg.json');
  writeFileSync(cfg, JSON.stringify({
    bin, meta,
    pedigree: { id: [...parents, ...hybrids], sire: [...parents.map(() => '0'), ...hybrids.map((g) => acc.get(g)!.p1)], dam: [...parents.map(() => '0'), ...hybrids.map((g) => acc.get(g)!.p2)] },
    pheno: { names: hybrids, traits }, folds: 5, reps: 2, heatmap_n: 100,
  }));

  console.log(`genomic-analyze: ${hybrids.length} hybrids × ${exp.nMarkers} markers ...`);
  const script = resolve(import.meta.dirname, '../../../services/kernel/genomic-analyze.R');
  const proc = spawnSync('Rscript', [script, cfg], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (proc.status !== 0) throw new Error(`genomic-analyze.R failed:\n${proc.stderr}`);
  const genomic = JSON.parse(proc.stdout);
  genomic.traits = TRAITS; // label order for the UI

  // merge into the latest bundle + re-validate + persist
  const [latest] = await db.select().from(resultBundle).orderBy(desc(resultBundle.id)).limit(1);
  if (!latest) throw new Error('no result bundle to augment — run met-build first');
  const merged = { ...(latest.bundle as ResultBundle), genomic } as ResultBundle;
  const validated = validateResultBundle(merged);
  await db.update(resultBundle).set({ bundle: validated }).where(eq(resultBundle.id, latest.id));

  const cmp = (genomic.model_comparison as Array<{ trait: string; model: string; predictive_ability: number }>);
  console.log(`merged genomic block into bundle ${latest.id}`);
  console.log(`  cohort ${genomic.cohort_n} × ${genomic.n_markers} markers; PCA var ${genomic.pca.var_explained.slice(0, 3).join('/')}`);
  for (const tr of TRAITS) {
    const g = cmp.find((x) => x.trait === tr && x.model === 'genomic_G')!.predictive_ability;
    const a = cmp.find((x) => x.trait === tr && x.model === 'pedigree_A')!.predictive_ability;
    console.log(`  ${tr.padEnd(18)} G=${g} A=${a}`);
  }
  await db.$client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
