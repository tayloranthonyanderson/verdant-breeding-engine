// The genotype-cohort intake module. The four genomic drivers (build / validate / ssgblup / check)
// all need the same view of the MET cohort: per-hybrid trait means, the genotyped subset (which
// hybrids have a CallSet), and a founders-first pedigree. This builds that view ONCE — parse the
// fixture via the g2f adapter (the only place G2F column names live), export the cohort's dosages
// (grm.ts), and expose pure helpers for means / pedigree / phenotype vectors — so no driver
// re-implements the parse or touches G2F column names. Defaults target the genotyped subset (the
// common case); ssGBLUP passes the full phenotyped set to predict un-genotyped lines via pedigree.
import { parseG2fHybrids } from './g2f';
import { exportCohortDosages, type DosageExport } from './grm';
import { metFixture } from './paths';

/** The MET dev fixture (ADR-0015: a fixture, not a built-in — crop specifics stay in the adapter). */
export const MET_FIXTURE = metFixture();

export interface GenomicCohort {
  traits: string[];
  /** every parsed genotype (filtered to phenotyped on trait[0] when requirePhenotyped), parse order. */
  hybrids: string[];
  /** the genotyped subset (those with a CallSet), in cohort order. */
  matched: string[];
  export: DosageExport;
  /** per-hybrid mean of trait `t` (index into `traits`); null when unobserved. */
  mean(genotype: string, t: number): number | null;
  /** founder parent names for the given hybrids (default: the genotyped subset). */
  parents(ids?: string[]): string[];
  /** founders-first pedigree over the given hybrids (default: the genotyped subset). */
  pedigree(ids?: string[]): { id: string[]; sire: string[]; dam: string[] };
  /** per-trait phenotype vectors aligned to the given hybrids (default: the genotyped subset). */
  phenoByTrait(ids?: string[]): Record<string, (number | null)[]>;
}

export interface GenomicInputsOpts {
  traits: string[];
  binPath: string;
  metaPath: string;
  mafMin?: number;
  maxMarkers?: number;
  /** keep only genotypes with at least one observation of trait[0] (ssGBLUP's phenotyped set). */
  requirePhenotyped?: boolean;
  csvPath?: string;
  /** also write a BLUPF90 SNP text file (for native genomic GBLUP). */
  snpPath?: string;
}

export async function buildGenomicInputs(opts: GenomicInputsOpts): Promise<GenomicCohort> {
  const { traits, binPath, metaPath } = opts;
  let parsed = parseG2fHybrids(opts.csvPath ?? MET_FIXTURE, traits);
  if (opts.requirePhenotyped) parsed = parsed.filter((hy) => hy.n[0] > 0);
  const byGeno = new Map(parsed.map((hy) => [hy.genotype, hy]));
  const hybrids = parsed.map((hy) => hy.genotype);

  const exp = await exportCohortDosages(hybrids, binPath, metaPath, {
    mafMin: opts.mafMin ?? 0.05,
    maxMarkers: opts.maxMarkers ?? 50000,
    snpPath: opts.snpPath,
  });

  const mean = (g: string, t: number): number | null => {
    const a = byGeno.get(g)!;
    return a.n[t] ? a.sum[t] / a.n[t] : null;
  };
  const parents = (ids: string[] = exp.matched): string[] =>
    [...new Set(ids.flatMap((g) => [byGeno.get(g)!.parent1, byGeno.get(g)!.parent2]))].filter(Boolean);
  const pedigree = (ids: string[] = exp.matched) => {
    const founders = parents(ids);
    return {
      id: [...founders, ...ids],
      sire: [...founders.map(() => '0'), ...ids.map((g) => byGeno.get(g)!.parent1)],
      dam: [...founders.map(() => '0'), ...ids.map((g) => byGeno.get(g)!.parent2)],
    };
  };
  const phenoByTrait = (ids: string[] = exp.matched): Record<string, (number | null)[]> => {
    const out: Record<string, (number | null)[]> = {};
    traits.forEach((tr, t) => {
      out[tr] = ids.map((g) => mean(g, t));
    });
    return out;
  };

  return { traits, hybrids, matched: exp.matched, export: exp, mean, parents, pedigree, phenoByTrait };
}
