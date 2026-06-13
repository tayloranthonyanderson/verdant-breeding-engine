// Seed the SYNTHETIC inbred-line fixture (ADR-0020) for the G2F maize dev set. G2F gives us parent
// IDENTITY only — no inbred pool, no per-se phenotype, no directly-observed native-trait call — so
// we synthesize those here, deterministically, purely to wire the combining-ability engine + UI.
// Real tomato inbred data replaces this later. Nothing here is real maize biology.
//
//   pnpm --filter @verdant/pipeline exec tsx src/seed-inbred.ts
//
import { eq } from 'drizzle-orm';
import { db, pool as pgPool, program, inbredLine } from '@verdant/db';
import { parseG2fHybrids } from './g2f';
import { metFixture } from './paths';
import { isEntrypoint } from './entry';

const PROG = 'G2F (public dev data)';
const FIXTURE = metFixture();
const YIELD = 'Yield_Mg_ha';

// Deterministic [0,1) hash of a string (FNV-1a → unit interval). Reproducible: no RNG.
function unit(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 100000) / 100000;
}
// Two independent hash draws → an approx-standard-normal (Box–Muller), deterministic per name.
function gauss(name: string): number {
  const u1 = Math.max(1e-6, unit(name + '#a'));
  const u2 = unit(name + '#b');
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

async function main() {
  const hybrids = parseG2fHybrids(FIXTURE, [YIELD]);

  // Classify each distinct parent by its dominant role (parent1=line vs parent2=tester) and, for
  // lines, tally testcross yield (sum/n) + which tester it was most often crossed to.
  type Agg = { asLine: number; asTester: number; ySum: number; yN: number; testers: Map<string, number> };
  const agg = new Map<string, Agg>();
  const get = (n: string): Agg =>
    agg.get(n) ?? (agg.set(n, { asLine: 0, asTester: 0, ySum: 0, yN: 0, testers: new Map() }), agg.get(n)!);
  for (const h of hybrids) {
    if (!h.parent1 || !h.parent2) continue;
    const a = get(h.parent1), b = get(h.parent2);
    a.asLine++; b.asTester++;
    a.ySum += h.sum[0]; a.yN += h.n[0];
    a.testers.set(h.parent2, (a.testers.get(h.parent2) ?? 0) + 1);
  }

  // Two-pool assignment: a line's heterotic pool is OPPOSITE its tester's group. The two dominant
  // testers (LH195, PHT69) anchor the two groups; a line crossed mainly to LH195 → Pool A, mainly to
  // PHT69 → Pool B; lines on minor testers fall by a stable hash. (Synthetic but breeding-shaped.)
  const POOL_OF_TESTER: Record<string, 'A' | 'B'> = { LH195: 'A', PHT69: 'B' };
  const lineYields: number[] = [];
  const rows: Array<typeof inbredLine.$inferInsert> = [];

  const programId = (async () => {
    await db.insert(program).values({ name: PROG }).onConflictDoNothing();
    const [p] = await db.select().from(program).where(eq(program.name, PROG));
    return p.id;
  });
  const pid = await programId();

  // first pass: line testcross-yield mean for standardization
  const lineMean = new Map<string, number>();
  for (const [name, a] of agg) {
    const isTester = a.asTester > a.asLine && a.asTester >= 5;
    if (!isTester && a.yN > 0) { const m = a.ySum / a.yN; lineMean.set(name, m); lineYields.push(m); }
  }
  const mu = lineYields.reduce((s, x) => s + x, 0) / (lineYields.length || 1);
  const sd = Math.sqrt(lineYields.reduce((s, x) => s + (x - mu) ** 2, 0) / ((lineYields.length - 1) || 1)) || 1;

  for (const [name, a] of agg) {
    const isTester = a.asTester > a.asLine && a.asTester >= 5;
    let assignedPool: string | null = null;
    if (!isTester) {
      const domTester = [...a.testers.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
      assignedPool = (domTester && POOL_OF_TESTER[domTester]) || (unit(name) < 0.5 ? 'A' : 'B');
    }
    // synthetic per-se yield: correlated with (but not equal to) testcross performance, so per-se↔GCA
    // diverges. r≈0.6 with the line's testcross mean; deterministic noise from the name hash.
    const z = lineMean.has(name) ? (lineMean.get(name)! - mu) / sd : 0;
    const perSe = isTester ? null : Number((0.6 * z + 0.8 * gauss(name)).toFixed(4));
    // native qualitative trait Ht1 / NCLB resistance: ~38% of lines carry it (directly observed on
    // the inbred). Testers left null (not the selection unit here).
    const nclb = isTester ? null : (unit(name + '#nclb') < 0.38 ? 1 : 0);

    rows.push({
      programId: pid, name,
      role: isTester ? 'tester' : 'line',
      pool: assignedPool,
      perSeValue: perSe,
      nctlbResistant: nclb,
      synthetic: 1,
    });
  }

  // upsert (idempotent on program+name)
  await db.delete(inbredLine).where(eq(inbredLine.programId, pid));
  for (let i = 0; i < rows.length; i += 500) {
    await db.insert(inbredLine).values(rows.slice(i, i + 500)).onConflictDoNothing();
  }

  const nLine = rows.filter((r) => r.role === 'line').length;
  const nTester = rows.filter((r) => r.role === 'tester').length;
  const nA = rows.filter((r) => r.pool === 'A').length;
  const nB = rows.filter((r) => r.pool === 'B').length;
  const nRes = rows.filter((r) => r.nctlbResistant === 1).length;
  console.log(`seeded inbred_line: ${rows.length} rows (${nLine} lines, ${nTester} testers)`);
  console.log(`  pools: A=${nA} B=${nB};  NCLB-resistant lines=${nRes} (${((100 * nRes) / nLine).toFixed(0)}%)`);
  await pgPool.end();
}

if (isEntrypoint(import.meta.url)) main().catch(async (e) => { console.error(e); await pgPool.end(); process.exit(1); });
