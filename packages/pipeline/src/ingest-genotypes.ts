// Ingest the G2F hybrid genotype VCF into the genotyping tables (ADR-0017): stream the 8.6 GB VCF,
// convert GT → dosage (0/0→0, het→1, 1/1→2, ./.→255 missing), pack each sample's dosages into a
// bytea (ordered by variant.idx), compute per-marker MAF + call-rate (raw store — NO filtering),
// and load variant_set / variant / sample / call_set.
//
// Run: corepack pnpm --filter @verdant/pipeline exec tsx src/ingest-genotypes.ts
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import { db, variantSet, variant, sample, callSet } from '@verdant/db';

const ZIP = resolve(import.meta.dirname, '../../../data/g2f/raw/5_Genotype_Data_All_Years.vcf.zip');
const SET_NAME = 'G2F 2014-2023 hybrids (437k, competition VCF)';
const N_MARKERS = 437214; // verified by counting non-header lines
const MISSING = 255;
const round = (x: number) => Number(x.toFixed(5));

async function main() {
  // 0. clean any prior load of this set (idempotent re-runs); samples are shared, so keep them.
  const prior = await db.select({ id: variantSet.id }).from(variantSet).where(eq(variantSet.name, SET_NAME));
  if (prior.length) {
    await db.delete(callSet).where(eq(callSet.variantSetId, prior[0].id));
    await db.delete(variant).where(eq(variant.variantSetId, prior[0].id));
    await db.delete(variantSet).where(eq(variantSet.id, prior[0].id));
    console.log('cleared prior load of this variant set');
  }

  // 1. stream + parse the VCF, building packed per-sample dosage buffers + per-marker QC.
  const proc = spawn('unzip', ['-p', ZIP]);
  proc.stderr.on('data', () => {}); // ignore unzip "extracting" noise
  const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });

  let samples: string[] = [];
  let nSamples = 0;
  let sampleBuf: Buffer[] = [];
  let sampleCalled: Uint32Array = new Uint32Array(0);
  const vmeta: Array<{ idx: number; name: string; chrom: string; pos: number; ref: string; alt: string; maf: number; callRate: number }> = [];
  let m = 0;
  const t0 = Date.now();

  for await (const line of rl) {
    if (line.charCodeAt(0) === 35) {
      // '#'
      if (line.startsWith('#CHROM')) {
        samples = line.split('\t').slice(9);
        nSamples = samples.length;
        sampleBuf = samples.map(() => Buffer.alloc(N_MARKERS, MISSING));
        sampleCalled = new Uint32Array(nSamples);
        console.log(`samples: ${nSamples}; allocating ${((nSamples * N_MARKERS) / 1e9).toFixed(2)} GB of dosage buffers`);
      }
      continue;
    }
    // first 9 tab positions → metadata fields + start of the GT section
    const tabs: number[] = [];
    let p = -1;
    for (let i = 0; i < 9; i++) {
      p = line.indexOf('\t', p + 1);
      tabs.push(p);
    }
    const chrom = line.slice(0, tabs[0]);
    const pos = Number(line.slice(tabs[0] + 1, tabs[1]));
    const id = line.slice(tabs[1] + 1, tabs[2]);
    const ref = line.slice(tabs[2] + 1, tabs[3]);
    const alt = line.slice(tabs[3] + 1, tabs[4]);
    const gtStart = tabs[8] + 1;

    // Fast path: FORMAT is "GT" only → each sample field is a 3-char diploid GT + tab.
    const uniform = line.length === gtStart + nSamples * 4 - 1;
    let altA = 0;
    let called = 0;
    if (uniform) {
      for (let s = 0; s < nSamples; s++) {
        const off = gtStart + s * 4;
        const a = line.charCodeAt(off);
        let d: number;
        if (a === 46) d = MISSING; // '.'
        else {
          const b = line.charCodeAt(off + 2);
          d = (a === 49 ? 1 : 0) + (b === 49 ? 1 : 0); // '1' = 49
          called++;
          altA += d;
          sampleCalled[s]++;
        }
        sampleBuf[s][m] = d;
      }
    } else {
      // robust fallback for any non-3-char field
      const gts = line.slice(gtStart).split('\t');
      for (let s = 0; s < nSamples; s++) {
        const g = gts[s];
        let d: number;
        if (!g || g.charCodeAt(0) === 46) d = MISSING;
        else {
          d = (g.charCodeAt(0) === 49 ? 1 : 0) + (g.charCodeAt(2) === 49 ? 1 : 0);
          called++;
          altA += d;
          sampleCalled[s]++;
        }
        sampleBuf[s][m] = d;
      }
    }
    const an = called * 2;
    const pAlt = an ? altA / an : 0;
    vmeta.push({ idx: m, name: id, chrom, pos, ref, alt, maf: round(Math.min(pAlt, 1 - pAlt)), callRate: round(called / nSamples) });
    m++;
    if (m % 50000 === 0) console.log(`  ${m} markers parsed (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  if (m !== N_MARKERS) throw new Error(`expected ${N_MARKERS} markers, parsed ${m}`);
  console.log(`parsed ${m} markers × ${nSamples} samples in ${((Date.now() - t0) / 1000).toFixed(0)}s; loading DB ...`);

  // 2. variant_set
  const [vs] = await db
    .insert(variantSet)
    .values({
      name: SET_NAME, crop: 'maize', platform: 'TASSEL hybrid build (437k)',
      genomeBuild: 'B73 (contigs 1-10)', encoding: 'dosage_u8',
      nVariants: N_MARKERS, nCallSets: nSamples,
      source: 'G2F GxE 2022 competition · CyVerse DOI 10.25739/tq5e-ak26',
    })
    .returning({ id: variantSet.id });
  const setId = vs.id;

  // 3. samples (shared; upsert by name), then map VCF column order → sample id
  for (let i = 0; i < nSamples; i += 1000)
    await db.insert(sample).values(samples.slice(i, i + 1000).map((name) => ({ name }))).onConflictDoNothing();
  const srows = await db.select({ id: sample.id, name: sample.name }).from(sample).where(inArray(sample.name, samples));
  const nameToId = new Map(srows.map((r) => [r.name, r.id]));
  const sampleIds = samples.map((n) => nameToId.get(n)!);

  // 4. variants (437k, batched)
  for (let i = 0; i < vmeta.length; i += 2000) {
    await db.insert(variant).values(
      vmeta.slice(i, i + 2000).map((v) => ({
        variantSetId: setId, idx: v.idx, name: v.name, chrom: v.chrom, pos: v.pos,
        alleleRef: v.ref, alleleAlt: v.alt, maf: v.maf, callRate: v.callRate,
      })),
    );
  }
  console.log('variants loaded');

  // 5. call_sets (packed dosage bytea per sample, batched)
  for (let i = 0; i < nSamples; i += 50) {
    const batch = [];
    for (let s = i; s < Math.min(i + 50, nSamples); s++)
      batch.push({ variantSetId: setId, sampleId: sampleIds[s], dosages: sampleBuf[s], callRate: round(sampleCalled[s] / N_MARKERS) });
    await db.insert(callSet).values(batch);
    if (i % 1000 === 0) console.log(`  call_sets ${i}/${nSamples}`);
  }

  console.log(`done: variant_set=${setId}, ${N_MARKERS} variants, ${nSamples} call_sets`);
  await db.$client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
