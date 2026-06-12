// Smoke-check the BLUPF90 adapter on the MET fixture: should reproduce the genetic correlations
// obtained by the manual run (height-yield ~0.15, yield-moisture ~-0.03, height-moisture ~0.00).
// Run: pnpm --filter @verdant/pipeline exec tsx src/blupf90-check.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { estimateGeneticCovariance } from './blupf90';

const csv = resolve(import.meta.dirname, '../../../data/g2f/MET_2019.csv');
const text = readFileSync(csv, 'utf8').trim().split('\n');
const header = text[0].split(',');
const col = (name: string) => header.indexOf(name);
const ENV = col('Env'), GENO = col('Hybrid');
const traitCols = ['Plant_Height_cm', 'Yield_Mg_ha', 'Grain_Moisture'];
const ix = traitCols.map(col);

const rows = text.slice(1).map((line) => {
  const f = line.split(',');
  return {
    genotype: f[GENO],
    environment: f[ENV],
    values: ix.map((i) => (f[i] === 'NA' || f[i] === '' ? null : Number(f[i]))),
  };
});

console.log(`rows: ${rows.length}, traits: ${traitCols.join(', ')}`);
const res = estimateGeneticCovariance({ variableIds: ['height', 'yield', 'moisture'], rows });

const fmt = (M: number[][]) => M.map((r) => r.map((x) => x.toFixed(3).padStart(8)).join('')).join('\n');
console.log(`\nconverged: ${res.converged} (rounds: ${res.rounds}), engine: ${res.engine}`);
console.log('\ngenetic correlation:\n' + fmt(res.geneticCorrelation));
console.log('\ngenetic variances: ' + res.geneticVariances.map((x) => x.toFixed(3)).join(', '));
console.log('\nresidual correlation:\n' + fmt(res.residualCorrelation));
