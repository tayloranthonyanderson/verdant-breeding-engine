// Native genomic GBLUP via BLUPF90 (ADR-0014/0018, Phase 2). The renumf90 → preGSf90 (builds VanRaden
// G from the SNP file) → blupf90+ pipeline, multi-trait, with FIXED (co)variances supplied by the
// caller (the phenotypic fit's genetic + residual matrices) — so G is built once and all traits solve
// in a single run. Kept SEPARATE from blupf90.ts's VCE module (architecture review Candidate 4). An
// all-founder pedigree + SNP file = pure GBLUP. Returns per-trait genotype-effect solutions (GEBVs)
// keyed to original ids via renadd02.ped. This is the scale engine; rrBLUP is the fast default, and
// the two agree (docs/validation/cross-engine-concordance.md).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, copyFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const IMAGE = 'verdant-blupf90';
// colima mounts $HOME into the VM; the work dir (and the SNP file) must live under $HOME, not /tmp.
const WORK_ROOT = join(homedir(), '.verdant', 'blupf90');

export interface GenomicGblupResult {
  /** per trait id: GEBVs keyed to original genotype id. */
  gebvByTrait: Record<string, Array<{ id: string; gebv: number }>>;
  engine: string;
}

/** Multi-trait genomic GBLUP (native BLUPF90). `phenoByTrait[trait]` is aligned to `ids`; `snpPath` is
 *  a fixed-width BLUPF90 SNP text file (id + 0/1/2/5), e.g. from exportCohortDosages({ snpPath }); it
 *  must live under $HOME so colima can mount it. `geneticCovariance`/`residualCovariance` are the fixed
 *  n×n (co)variance matrices (n = traits.length) — typically the phenotypic fit's estimates. */
export function genomicGblup(opts: {
  ids: string[];
  traits: string[];
  phenoByTrait: Record<string, Array<number | null>>;
  snpPath: string;
  geneticCovariance: number[][];
  residualCovariance: number[][];
  image?: string;
}): GenomicGblupResult {
  const { ids, traits } = opts;
  const n = traits.length;
  const image = opts.image ?? IMAGE;
  mkdirSync(WORK_ROOT, { recursive: true });
  const dir = mkdtempSync(join(WORK_ROOT, 'gblup-'));
  try {
    // data: `mu id y1..yn` (mu = constant 1 fixed effect, NA→0 missing code); pedigree: all founders.
    const MISSING = 0;
    let maxIdLen = 1;
    const data: string[] = [];
    const ped: string[] = [];
    ids.forEach((id, i) => {
      maxIdLen = Math.max(maxIdLen, id.length);
      ped.push(`${id} 0 0`);
      const vals = traits.map((t) => {
        const v = opts.phenoByTrait[t]?.[i];
        return v == null || !Number.isFinite(v) ? MISSING : v;
      });
      if (vals.every((v) => v === MISSING)) return; // all-missing row
      data.push(`1 ${id} ${vals.join(' ')}`);
    });
    if (data.length === 0) throw new Error('genomicGblup: no phenotyped records');
    writeFileSync(join(dir, 'data.txt'), data.join('\n') + '\n');
    writeFileSync(join(dir, 'ped.txt'), ped.join('\n') + '\n');
    copyFileSync(opts.snpPath, join(dir, 'snp.txt'));

    const traitCols = Array.from({ length: n }, (_, i) => i + 3).join(' '); // mu=1, id=2, traits=3..
    const par = [
      'DATAFILE', 'data.txt',
      'TRAITS', traitCols,
      'FIELDS_PASSED TO OUTPUT', '',
      'WEIGHT(S)', '',
      'RESIDUAL_VARIANCE', matrixBlock(opts.residualCovariance),
      'EFFECT', `${repeat('1', n)} cross alpha`, // mu (constant)
      'EFFECT', `${repeat('2', n)} cross alpha`, // genotype id → genomic random effect
      'RANDOM', 'animal',
      'FILE', 'ped.txt',
      'FILE_POS', `1 2 3 0 0`,
      'SNP_FILE', 'snp.txt',
      '(CO)VARIANCES', matrixBlock(opts.geneticCovariance),
      'OPTION SNP_file snp.txt',
      // GBLUP: skip preGSf90's G-tuning (segfaults on the all-founder A22=I) and blend G* = 0.95·G +
      // 0.05·A22(=I) — a ridge that makes G* PD/invertible (pure G is singular). FIXED variances.
      'OPTION tunedG 0',
      'OPTION AlphaBeta 0.95 0.05',
      `OPTION alpha_size ${Math.max(20, maxIdLen + 4)}`,
    ].join('\n') + '\n';
    writeFileSync(join(dir, 'renum.par'), par);

    const script =
      'cd /work && echo renum.par | renumf90 > renum.log 2>&1 && echo renf90.par | preGSf90 > pregs.log 2>&1 && echo renf90.par | blupf90+ > blup.log 2>&1';
    const proc = spawnSync('docker', ['run', '--rm', '-v', `${dir}:/work`, image, 'sh', '-c', script], {
      encoding: 'utf8',
      maxBuffer: 1 << 26,
    });
    if (proc.status !== 0) {
      const log = safeRead(join(dir, 'blup.log')) || safeRead(join(dir, 'pregs.log')) || safeRead(join(dir, 'renum.log'));
      throw new Error(`BLUPF90 GBLUP failed (exit ${proc.status}):\n${log}\n${proc.stderr}`);
    }

    // level → original id from renadd02.ped (col 1 = renumbered animal, last col = original id).
    const level2id = new Map<number, string>();
    for (const line of safeRead(join(dir, 'renadd02.ped')).split('\n')) {
      const t = line.trim().split(/\s+/);
      if (t.length < 2) continue;
      const lvl = Number(t[0]);
      const id = t[t.length - 1];
      if (Number.isFinite(lvl) && id) level2id.set(lvl, id);
    }
    const gebvByTrait: Record<string, Array<{ id: string; gebv: number }>> = {};
    for (const t of traits) gebvByTrait[t] = [];
    for (const line of safeRead(join(dir, 'solutions')).split('\n')) {
      const t = line.trim().split(/\s+/);
      if (t.length < 4) continue;
      const trait = Number(t[0]), effect = Number(t[1]), level = Number(t[2]), sol = Number(t[3]);
      if (effect !== 2 || !Number.isFinite(sol) || !(trait >= 1 && trait <= n)) continue;
      const id = level2id.get(level);
      if (id) gebvByTrait[traits[trait - 1]].push({ id, gebv: sol });
    }
    return { gebvByTrait, engine: 'blupf90+/preGSf90 (GBLUP)' };
  } finally {
    if (!process.env.VERDANT_KEEP_DIR) rmSync(dir, { recursive: true, force: true });
    else console.error(`[gblup] kept work dir: ${dir}`);
  }
}

const repeat = (s: string, k: number) => Array.from({ length: k }, () => s).join(' ');
const matrixBlock = (M: number[][]): string =>
  M.map((row) => row.map((x) => x.toPrecision(8)).join(' ')).join('\n');
function safeRead(p: string): string {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}
