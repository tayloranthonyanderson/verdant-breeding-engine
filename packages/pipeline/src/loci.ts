// Synthetic major-gene LOCI for the combining-ability native-trait gate (ADR-0020). G2F gives no
// directly-observed inbred marker calls, so we synthesize a small panel of qualitative resistance /
// quality loci — each with two alleles — and a deterministic homozygous call per inbred (an inbred is
// ~fully homozygous). The breeder gates advancement on "must carry allele X at locus L" — marker-assisted
// selection. Scaffolding until real maize inbred genotyping lands (Ht1 for northern corn leaf blight, etc.).

export interface Locus {
  locus: string;       // marker/gene symbol
  trait: string;       // what it confers
  alleles: [string, string]; // the two alleles (order not significant)
  favorable: string;   // the resistant / desirable allele (one of `alleles`)
  freq: number;        // synthetic frequency of the favorable allele in the panel
}

// Maize major genes (apt for the G2F dev set). The favorable allele is the resistant/specialty one.
export const LOCI_CATALOG: Locus[] = [
  { locus: "Ht1", trait: "Northern corn leaf blight resistance", alleles: ["Ht1", "ht1"], favorable: "Ht1", freq: 0.42 },
  { locus: "Ht2", trait: "NCLB resistance (Ht2 gene)", alleles: ["Ht2", "ht2"], favorable: "Ht2", freq: 0.33 },
  { locus: "Rcg1", trait: "Anthracnose stalk-rot resistance", alleles: ["Rcg1", "rcg1"], favorable: "Rcg1", freq: 0.5 },
  { locus: "wx1", trait: "Waxy endosperm (specialty starch)", alleles: ["Wx", "wx"], favorable: "wx", freq: 0.18 },
];

/** Deterministic [0,1) hash (FNV-1a → unit interval). No RNG — reproducible per (name, locus). */
function unit(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return ((h >>> 0) % 100000) / 100000;
}

/** A line's homozygous allele at each locus, deterministic from its name. */
export function allelesFor(name: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const L of LOCI_CATALOG) {
    const other = L.alleles[0] === L.favorable ? L.alleles[1] : L.alleles[0];
    out[L.locus] = unit(`${name}#${L.locus}`) < L.freq ? L.favorable : other;
  }
  return out;
}
