// Parse a single-environment G2F trait CSV into the rows we ingest. The AI-assisted, general
// column-mapper is M1 (ADR-0007); this M0 parser hard-maps the known G2F column names.
import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';

/** A trait column to ingest+analyze, mapped to a contract ObservationVariable. */
export interface TraitSpec {
  column: string; // G2F column, e.g. "Yield_Mg_ha"
  name: string; // display name
  unit?: string;
}

export interface ParsedStudy {
  env: string;
  year: number | null;
  fieldLocation: string | null;
  traits: TraitSpec[];
  units: {
    plot: number;
    hybrid: string;
    parent1: string | null;
    parent2: string | null;
    replicate: string | null;
    block: string | null;
    row: number | null; // G2F Range
    col: number | null; // G2F Pass
  }[];
  observations: { plot: number; column: string; value: number }[];
}

const toNum = (x: string | undefined): number | null => {
  if (x == null || x.trim() === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

/** Parse a multi-environment G2F CSV into the generic plot record (ADR-0015). This is the ONLY
 *  place G2F column names (Hybrid, Env, Range, Pass, Replicate, Block) are referenced for the MET
 *  path — the engine and the two-stage pipeline never see them. `traitColumns` are the trait headers
 *  to extract, in the order the engine reports its matrices. */
export function parseG2fMet(
  path: string,
  traitColumns: string[],
): { variableIds: string[]; records: import('./stage1').PlotRecord[] } {
  const records = parse(readFileSync(path), { columns: true, skip_empty_lines: true }) as Record<
    string,
    string
  >[];
  if (records.length === 0) throw new Error(`No rows in ${path}`);
  const out = records.map((r) => ({
    genotype: r.Hybrid,
    environment: r.Env,
    row: toNum(r.Range), // G2F Range → generic field row
    col: toNum(r.Pass), //  G2F Pass  → generic field col
    rep: r.Replicate || null,
    values: traitColumns.map((c) => toNum(r[c])),
  }));
  return { variableIds: traitColumns, records: out };
}

/** Per-hybrid trait sums/counts + parentage for the genomic cohort path. Like parseG2fMet, this
 *  confines the G2F genotype/parent column names (Hybrid, Hybrid_Parent1/2) to this adapter — the
 *  genomic-inputs module and the kernels see only generic ids, means, and pedigree. One record per
 *  genotype, in first-appearance order; callers divide sum/n for means and assemble the pedigree. */
export interface G2fHybrid {
  genotype: string;
  parent1: string;
  parent2: string;
  sum: number[]; // aligned to traitColumns
  n: number[];
}

export function parseG2fHybrids(path: string, traitColumns: string[]): G2fHybrid[] {
  const records = parse(readFileSync(path), { columns: true, skip_empty_lines: true }) as Record<
    string,
    string
  >[];
  if (records.length === 0) throw new Error(`No rows in ${path}`);
  const byGeno = new Map<string, G2fHybrid>();
  for (const r of records) {
    let a = byGeno.get(r.Hybrid);
    if (!a) {
      a = {
        genotype: r.Hybrid,
        parent1: r.Hybrid_Parent1,
        parent2: r.Hybrid_Parent2,
        sum: traitColumns.map(() => 0),
        n: traitColumns.map(() => 0),
      };
      byGeno.set(r.Hybrid, a);
    }
    traitColumns.forEach((c, t) => {
      const v = toNum(r[c]);
      if (v != null) {
        a!.sum[t] += v;
        a!.n[t] += 1;
      }
    });
  }
  return [...byGeno.values()];
}

export function parseG2fCsv(path: string, traits: TraitSpec[]): ParsedStudy {
  const records = parse(readFileSync(path), { columns: true, skip_empty_lines: true }) as Record<
    string,
    string
  >[];
  if (records.length === 0) throw new Error(`No rows in ${path}`);

  const units: ParsedStudy['units'] = [];
  const observations: ParsedStudy['observations'] = [];
  for (const r of records) {
    const plot = toNum(r.Plot);
    if (plot == null) continue;
    units.push({
      plot,
      hybrid: r.Hybrid,
      parent1: r.Hybrid_Parent1 || null,
      parent2: r.Hybrid_Parent2 || null,
      replicate: r.Replicate || null,
      block: r.Block || null,
      row: toNum(r.Range),
      col: toNum(r.Pass),
    });
    for (const t of traits) {
      const v = toNum(r[t.column]);
      if (v != null) observations.push({ plot, column: t.column, value: v });
    }
  }
  const first = records[0];
  return {
    env: first.Env,
    year: toNum(first.Year),
    fieldLocation: first.Field_Location || null,
    traits,
    units,
    observations,
  };
}
