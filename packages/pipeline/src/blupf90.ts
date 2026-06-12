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
  /** One row per observation unit (plot): its genotype, environment, and trait values (null = missing). */
  rows: Array<{ genotype: string; environment: string; values: Array<number | null> }>;
  /** Container image with blupf90+ and renumf90 (default: the verdant-blupf90 image). */
  image?: string;
  /** Max AI-REML rounds. */
  maxRounds?: number;
}

export interface GeneticCovarianceResult {
  variableIds: string[];
  geneticCovariance: number[][];
  geneticCorrelation: number[][];
  residualCovariance: number[][];
  residualCorrelation: number[][];
  geneticVariances: number[];
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
    // 1. Data file: env genotype t1 t2 ... — NA→0 (BLUPF90 missing code), drop all-missing rows.
    const MISSING = 0;
    let maxIdLen = 1;
    const lines: string[] = [];
    for (const r of rows) {
      if (r.values.every((v) => v == null || !Number.isFinite(v))) continue; // all-missing
      maxIdLen = Math.max(maxIdLen, r.genotype.length, r.environment.length);
      const vals = r.values.map((v) => (v == null || !Number.isFinite(v) ? MISSING : v));
      lines.push(`${r.environment} ${r.genotype} ${vals.join(' ')}`);
    }
    if (lines.length === 0) throw new Error('no usable rows for genetic covariance');
    writeFileSync(join(dir, 'met.dat'), lines.join('\n') + '\n');

    // 2. Starting (co)variances from empirical trait variances, split genetic/residual with small
    //    non-zero covariances so AI-REML estimates the FULL matrices (zero starts stay at zero).
    const emp = empiricalVariances(rows, n);
    const gStart = covStart(emp, 0.3, 0.1); // ~30% genetic, seed corr 0.1
    const rStart = covStart(emp, 0.7, 0.1); // ~70% residual

    // 3. renumf90 parameter file. Trait columns are 3..n+2 (after env, genotype). Each effect lists
    //    its data column PER TRAIT (multi-trait renumf90 requirement). Genotype is a diagonal (IID)
    //    random effect = identity relationship (the contract's default; A/G/H come later).
    const traitCols = Array.from({ length: n }, (_, i) => i + 3).join(' ');
    const allTraits = Array.from({ length: n }, () => '1').join(' ');
    const par = [
      'DATAFILE', 'met.dat',
      'TRAITS', traitCols,
      'FIELDS_PASSED TO OUTPUT', '',
      'WEIGHT(S)', '',
      'RESIDUAL_VARIANCE', matrixBlock(rStart),
      'EFFECT', `${repeat('1', n)} cross alpha`,   // environment (fixed)
      'EFFECT', `${repeat('2', n)} cross alpha`,   // genotype (random)
      'RANDOM', 'diagonal',
      '(CO)VARIANCES', matrixBlock(gStart),
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

    // 5. Parse the converged (co)variance matrices from blup.log.
    const log = readFileSync(join(dir, 'blup.log'), 'utf8');
    const G = parseMatrix(log, /Genetic variance\(s\)[^\n]*\n/, n);
    const R = parseMatrix(log, /Residual variance\(s\)[^\n]*\n/, n);
    const rounds = lastRound(log);
    return {
      variableIds,
      geneticCovariance: G,
      geneticCorrelation: cov2cor(G),
      residualCovariance: R,
      residualCorrelation: cov2cor(R),
      geneticVariances: G.map((row, i) => row[i]),
      converged: /convergence=\s*[\d.]+E?-(0[6-9]|1[0-9])/.test(log) || rounds != null,
      rounds,
      engine: 'blupf90+',
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
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

/** Read the N×N matrix that follows the header regex in the BLUPF90 log. */
function parseMatrix(log: string, header: RegExp, n: number): number[][] {
  const m = header.exec(log);
  if (!m) throw new Error(`could not find matrix header ${header} in BLUPF90 output`);
  const after = log.slice(m.index + m[0].length);
  const nums: number[] = [];
  for (const line of after.split('\n')) {
    const toks = line.trim().split(/\s+/).filter(Boolean);
    if (toks.length === 0) continue;
    const row = toks.map(Number);
    if (row.some((x) => !Number.isFinite(x))) break; // hit a non-numeric line (next section)
    nums.push(...row);
    if (nums.length >= n * n) break;
  }
  if (nums.length < n * n) throw new Error('incomplete matrix in BLUPF90 output');
  const M: number[][] = [];
  for (let i = 0; i < n; i++) M.push(nums.slice(i * n, i * n + n));
  return M;
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
