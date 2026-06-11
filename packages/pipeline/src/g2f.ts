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
