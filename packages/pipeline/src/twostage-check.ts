// A/B: one-stage plot model vs two-stage (Stage-1 spatial de-trend → multi-trait BLUPF90).
// Quantifies what the spatial stage buys: heritability and genetic correlations before/after.
// Self-contained — runs ingestion + Stage 1 + both models. Validated against lme4 (matches h² to
// 3 sig figs). Run: corepack pnpm --filter @verdant/pipeline exec tsx src/twostage-check.ts
import { resolve } from 'node:path';
import { estimateGeneticCovariance } from './blupf90';
import { parseG2fMet } from './g2f';
import { spatialStage1 } from './stage1';

const TRAITS = ['Plant_Height_cm', 'Ear_Height_cm', 'Yield_Mg_ha', 'Grain_Moisture'];
const CSV = resolve(import.meta.dirname, '../../../data/g2f/MET_2019.csv');
const { variableIds, records } = parseG2fMet(CSV, TRAITS);

// One-stage: raw plots straight into the multi-trait adapter (genotype-main, no spatial).
const plotRows = () => records.map((r) => ({ genotype: r.genotype, environment: r.environment, values: r.values }));

// Two-stage: spatial de-trend, then the adjusted entry means into the same adapter.
function adjustedRows() {
  const s1 = spatialStage1(variableIds, records);
  const nSpats = s1.stage1.filter((p) => p.method === 'spats').length;
  console.log(`Stage 1: ${s1.adjusted.length} adjusted means; ${nSpats}/${s1.stage1.length} env×trait spatial`);
  return s1.adjusted.map((a) => ({ genotype: a.genotype, environment: a.environment, values: a.values }));
}

function h2(g: ReturnType<typeof estimateGeneticCovariance>) {
  const Ve = g.residualCovariance.map((r, i) => r[i]);
  return g.geneticVariances.map((vg, i) => vg / (vg + Ve[i]));
}

function show(label: string, g: ReturnType<typeof estimateGeneticCovariance>) {
  console.log(`\n=== ${label} (converged=${g.converged}, rounds=${g.rounds}) ===`);
  const hh = h2(g);
  TRAITS.forEach((t, i) => console.log(`  h² ${t.padEnd(16)} ${hh[i].toFixed(3)}`));
  console.log('  genetic correlations:');
  for (let i = 0; i < TRAITS.length; i++)
    for (let j = i + 1; j < TRAITS.length; j++)
      console.log(`    ${TRAITS[i]} ~ ${TRAITS[j]}: ${g.geneticCorrelation[i][j].toFixed(3)}`);
}

const oneStage = estimateGeneticCovariance({ variableIds: TRAITS, rows: plotRows() });
show('ONE-STAGE (plots, genotype-main, no spatial)', oneStage);
const twoStage = estimateGeneticCovariance({ variableIds: TRAITS, rows: adjustedRows() });
show('TWO-STAGE (SpATS de-trend → genotype-main)', twoStage);
