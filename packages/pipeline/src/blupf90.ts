// BLUPF90 adapter — multi-trait variance-component estimation behind a generic interface.
//
// Per ADR-0014, BLUPF90 (AIREMLF90 via blupf90+) is the engine for multi-trait variance components
// — the genetic covariance matrix G that the Smith–Hazel index needs — and for genomic scale. It is
// a compiled binary, run as a containerized subprocess (ADR-0012 generalized from Rscript to any
// binary). This module is crop-agnostic: it takes generic (genotype, environment, trait values)
// rows and derives everything BLUPF90 needs (alpha_size, missing handling, starting values) FROM
// THE DATA — no crop or G2F assumptions.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

export interface GeneticCovarianceInput {
  /** Stable trait ids, in the order the matrices are reported. */
  variableIds: string[];
  /** One row per observation unit: its genotype, environment, trait values (null = missing), and —
   *  for a weighted two-stage — the per-trait weight (1/SE²) from Stage 1 (null/absent = unweighted). */
  rows: Array<{
    genotype: string;
    environment: string;
    values: Array<number | null>;
    weights?: Array<number | null>;
  }>;
  /** Add a genotype×environment random effect (GxE). Needs genotypes connected across environments;
   *  with one record per genotype×env it relies on a weighted residual (see `weights`) to separate
   *  GxE from error. When set, the result carries `gxeCovariance`. */
  interaction?: boolean;
  /** Container image with blupf90+ and renumf90 (default: the verdant-blupf90 image). */
  image?: string;
  /** Max AI-REML rounds. */
  maxRounds?: number;
}

export interface GeneticCovarianceResult {
  variableIds: string[];
  geneticCovariance: number[][];
  geneticCorrelation: number[][];
  /** Genotype×environment (co)variance + correlation — present only when `interaction` was set. */
  gxeCovariance?: number[][];
  gxeCorrelation?: number[][];
  gxeVariances?: number[];
  residualCovariance: number[][];
  residualCorrelation: number[][];
  geneticVariances: number[];
  /** Per-genotype multi-trait BLUPs (genotype random-effect solutions), one entry per genotype. */
  blups: Array<{ genotype: string; values: Array<number | null> }>;
  converged: boolean;
  rounds: number | null;
  engine: string;
}

const IMAGE = 'verdant-blupf90';
// colima mounts the user home dir into the VM, so the work dir must live under $HOME (not /tmp,
// which macOS places under /var/folders and colima does not mount).
const WORK_ROOT = join(homedir(), '.verdant', 'blupf90');

/** Estimate the genetic (and residual) covariance matrices across traits via BLUPF90 AI-REML. */
export function estimateGeneticCovariance(input: GeneticCovarianceInput): GeneticCovarianceResult {
  const { variableIds, rows } = input;
  const n = variableIds.length;
  const image = input.image ?? IMAGE;
  if (n < 2) throw new Error('genetic covariance needs at least two traits');

  mkdirSync(WORK_ROOT, { recursive: true });
  const dir = mkdtempSync(join(WORK_ROOT, 'run-'));
  try {
    // 1. Data file. Columns: env genotype [geno_env] t1..tK [w1..wK] — NA→0 (BLUPF90 missing code),
    //    drop all-missing rows. `interaction` adds a genotype@environment level (GxE); a weighted
    //    two-stage adds one weight column PER TRAIT (blupf90+ accepts per-trait weights).
    const gxe = !!input.interaction;
    const weighted = rows.some((r) => Array.isArray(r.weights));
    const MISSING = 0;
    let maxIdLen = 1;
    const lines: string[] = [];
    for (const r of rows) {
      if (r.values.every((v) => v == null || !Number.isFinite(v))) continue; // all-missing
      const ge = `${r.genotype}@${r.environment}`;
      maxIdLen = Math.max(maxIdLen, r.genotype.length, r.environment.length, gxe ? ge.length : 0);
      const vals = r.values.map((v) => (v == null || !Number.isFinite(v) ? MISSING : v));
      let line = gxe ? `${r.environment} ${r.genotype} ${ge} ${vals.join(' ')}`
                     : `${r.environment} ${r.genotype} ${vals.join(' ')}`;
      if (weighted) {
        // 1/SE² per trait; present value with no/invalid weight → 1 (neutral); missing value → 1.
        const ws = r.values.map((v, j) => {
          const w = r.weights?.[j];
          return v == null || !Number.isFinite(v) ? 1 : Number.isFinite(w) && (w as number) > 0 ? (w as number) : 1;
        });
        line += ` ${ws.join(' ')}`;
      }
      lines.push(line);
    }
    if (lines.length === 0) throw new Error('no usable rows for genetic covariance');
    writeFileSync(join(dir, 'met.dat'), lines.join('\n') + '\n');

    // 2. Starting (co)variances from empirical trait variances, split genetic/residual with small
    //    non-zero covariances so AI-REML estimates the FULL matrices (zero starts stay at zero).
    const emp = empiricalVariances(rows, n);
    // Split empirical variance into genetic / (GxE) / residual starting blocks (small seed corrs so
    // AI-REML estimates the FULL matrices — zero starts stay at zero). With GxE the genetic share is
    // split between the main effect and the interaction.
    const gStart = covStart(emp, gxe ? 0.2 : 0.3, 0.1);
    const geStart = covStart(emp, 0.2, 0.05);
    const rStart = covStart(emp, gxe ? 0.6 : 0.7, 0.1);

    // 3. renumf90 parameter file. Data columns: env(1) genotype(2) [geno_env(3)] then traits, then
    //    (if weighted) one weight column per trait. Each effect lists its column PER TRAIT (multi-
    //    trait renumf90 requirement). Random effects are diagonal (IID) = identity relationship.
    const genoEnvCol = gxe ? 1 : 0;
    const firstTrait = 3 + genoEnvCol;
    const traitCols = Array.from({ length: n }, (_, i) => i + firstTrait).join(' ');
    const firstWeight = firstTrait + n;
    const weightCols = weighted ? Array.from({ length: n }, (_, i) => i + firstWeight).join(' ') : '';
    const effects = [
      'EFFECT', `${repeat('1', n)} cross alpha`,   // environment (fixed)
      'EFFECT', `${repeat('2', n)} cross alpha`,   // genotype (random) → G
      'RANDOM', 'diagonal',
      '(CO)VARIANCES', matrixBlock(gStart),
    ];
    if (gxe) effects.push(
      'EFFECT', `${repeat('3', n)} cross alpha`,   // genotype×environment (random) → GxE
      'RANDOM', 'diagonal',
      '(CO)VARIANCES', matrixBlock(geStart),
    );
    const par = [
      'DATAFILE', 'met.dat',
      'TRAITS', traitCols,
      'FIELDS_PASSED TO OUTPUT', '',
      'WEIGHT(S)', weightCols,
      'RESIDUAL_VARIANCE', matrixBlock(rStart),
      ...effects,
      'OPTION method VCE',
      `OPTION maxrounds ${input.maxRounds ?? 100}`,
      `OPTION alpha_size ${Math.max(20, maxIdLen + 4)}`,
    ].join('\n') + '\n';
    writeFileSync(join(dir, 'renum.par'), par);

    // 4. Run renumf90 then blupf90+ in the container (work dir mounted at /work).
    const script =
      'cd /work && echo renum.par | renumf90 > renum.log 2>&1 && echo renf90.par | blupf90+ > blup.log 2>&1';
    const proc = spawnSync('docker', ['run', '--rm', '-v', `${dir}:/work`, image, 'sh', '-c', script], {
      encoding: 'utf8',
      maxBuffer: 1 << 26,
    });
    if (proc.status !== 0) {
      const log = safeRead(join(dir, 'blup.log')) || safeRead(join(dir, 'renum.log'));
      throw new Error(`BLUPF90 failed (exit ${proc.status}):\n${log}\n${proc.stderr}`);
    }

    // 5. Parse the converged (co)variance matrices from blup.log. With GxE there are TWO genetic
    //    blocks (effect 2 = genotype → G, effect 3 = genotype×env → GxE), printed in effect order.
    const log = readFileSync(join(dir, 'blup.log'), 'utf8');
    const geneticBlocks = parseAllMatrices(log, /Genetic variance\(s\)[^\n]*\n/, n);
    if (geneticBlocks.length === 0) throw new Error('no genetic (co)variance block in BLUPF90 output');
    const G = geneticBlocks[0];
    const GxE = gxe ? geneticBlocks[1] : undefined;
    const R = parseMatrix(log, /Residual variance\(s\)[^\n]*\n/, n);
    const rounds = lastRound(log);
    const blups = parseGenotypeBlups(dir, n);
    return {
      variableIds,
      geneticCovariance: G,
      geneticCorrelation: cov2cor(G),
      gxeCovariance: GxE,
      gxeCorrelation: GxE ? cov2cor(GxE) : undefined,
      gxeVariances: GxE ? GxE.map((row, i) => row[i]) : undefined,
      residualCovariance: R,
      residualCorrelation: cov2cor(R),
      geneticVariances: G.map((row, i) => row[i]),
      blups,
      converged: /convergence=\s*[\d.]+E?-(0[6-9]|1[0-9])/.test(log) || rounds != null,
      rounds,
      engine: 'blupf90+',
    };
  } finally {
    if (!process.env.VERDANT_KEEP_DIR) rmSync(dir, { recursive: true, force: true });
    else console.error(`[blupf90] kept work dir: ${dir}`);
  }
}

// ---- helpers ---------------------------------------------------------------------------------

function empiricalVariances(rows: GeneticCovarianceInput['rows'], n: number): number[] {
  const out: number[] = [];
  for (let j = 0; j < n; j++) {
    const xs = rows.map((r) => r.values[j]).filter((v): v is number => v != null && Number.isFinite(v));
    const mean = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
    const v = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, xs.length - 1);
    out.push(Number.isFinite(v) && v > 0 ? v : 1);
  }
  return out;
}

/** Diagonal = fraction*var; off-diagonal = seedCorr * sqrt(var_i*var_j)*fraction (positive-definite-ish). */
function covStart(vars: number[], fraction: number, seedCorr: number): number[][] {
  const n = vars.length;
  const M = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    M[i][i] = vars[i] * fraction;
    for (let j = i + 1; j < n; j++) {
      const c = seedCorr * Math.sqrt(M[i][i] * vars[j] * fraction);
      M[i][j] = c;
      M[j][i] = c;
    }
  }
  return M;
}

function matrixBlock(M: number[][]): string {
  return M.map((row) => row.map((x) => x.toPrecision(8)).join(' ')).join('\n');
}

const repeat = (s: string, k: number) => Array.from({ length: k }, () => s).join(' ');

/** Pull the first n*n finite numbers out of `text` (an N×N matrix block), or null if too few. */
function numsAfter(text: string, n: number): number[] | null {
  const nums: number[] = [];
  for (const line of text.split('\n')) {
    const toks = line.trim().split(/\s+/).filter(Boolean);
    if (toks.length === 0) continue;
    const row = toks.map(Number);
    if (row.some((x) => !Number.isFinite(x))) break; // hit a non-numeric line (next section)
    nums.push(...row);
    if (nums.length >= n * n) break;
  }
  return nums.length >= n * n ? nums.slice(0, n * n) : null;
}

const toMatrix = (nums: number[], n: number): number[][] =>
  Array.from({ length: n }, (_, i) => nums.slice(i * n, i * n + n));

/** Read the N×N matrix that follows the first header match. */
function parseMatrix(log: string, header: RegExp, n: number): number[][] {
  const m = header.exec(log);
  if (!m) throw new Error(`could not find matrix header ${header} in BLUPF90 output`);
  const nums = numsAfter(log.slice(m.index + m[0].length), n);
  if (!nums) throw new Error('incomplete matrix in BLUPF90 output');
  return toMatrix(nums, n);
}

/** Read EVERY N×N matrix that follows each header match, in order (multi-effect AI-REML prints one
 *  genetic block per random effect: effect 2 = genotype, effect 3 = genotype×env). */
function parseAllMatrices(log: string, header: RegExp, n: number): number[][][] {
  const re = new RegExp(header.source, 'g');
  const out: number[][][] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(log)) !== null) {
    const nums = numsAfter(log.slice(m.index + m[0].length), n);
    if (nums) out.push(toMatrix(nums, n));
  }
  return out;
}

/** Per-genotype multi-trait BLUPs from the genotype random effect (effect #2): map renumbered
 *  levels back to original ids via renf90.tables, then read effect-2 solutions per trait. */
function parseGenotypeBlups(
  dir: string,
  nTraits: number,
): Array<{ genotype: string; values: Array<number | null> }> {
  const level2name = new Map<number, string>();
  let inEff2 = false;
  for (const line of safeRead(join(dir, 'renf90.tables')).split('\n')) {
    if (/Effect group/.test(line)) {
      inEff2 = /effect #\s*2\b/.test(line);
      continue;
    }
    if (!inEff2 || /consecutive number/.test(line)) continue;
    const toks = line.trim().split(/\s+/).filter(Boolean);
    if (toks.length < 3) continue;
    const level = Number(toks[toks.length - 1]);
    const name = toks.slice(0, toks.length - 2).join(' '); // id may contain '/', not spaces
    if (Number.isFinite(level) && name) level2name.set(level, name);
  }
  const byGeno = new Map<string, Array<number | null>>();
  for (const line of safeRead(join(dir, 'solutions')).split('\n')) {
    const t = line.trim().split(/\s+/);
    if (t.length < 4) continue;
    const trait = Number(t[0]), effect = Number(t[1]), level = Number(t[2]), sol = Number(t[3]);
    if (effect !== 2 || !Number.isFinite(sol) || !(trait >= 1 && trait <= nTraits)) continue;
    const name = level2name.get(level);
    if (!name) continue;
    if (!byGeno.has(name)) byGeno.set(name, Array(nTraits).fill(null));
    byGeno.get(name)![trait - 1] = sol;
  }
  return [...byGeno].map(([genotype, values]) => ({ genotype, values }));
}

function cov2cor(M: number[][]): number[][] {
  const n = M.length;
  const d = M.map((row, i) => Math.sqrt(row[i]));
  return M.map((row, i) => row.map((x, j) => (d[i] && d[j] ? x / (d[i] * d[j]) : 0)));
}

function lastRound(log: string): number | null {
  const all = [...log.matchAll(/In round\s+(\d+)\s+convergence/g)];
  return all.length ? Number(all[all.length - 1][1]) : null;
}

function safeRead(p: string): string {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}
