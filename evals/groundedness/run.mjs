#!/usr/bin/env node
// run.mjs — groundedness eval runner. Dependency-free (Node >=22).
// See README.md. Two modes: self-test the checker (always), and test a wired answerer (optional).
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
// The checker is SHARED with the runtime guardrail (packages/ai/src/grounding) — run under tsx — so
// the CI gate and the production guardrail can never drift. Run via: pnpm test:evals.
import { bundleNumbers, ungroundedNumbers, checkGrounding } from '../../packages/ai/src/grounding';

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(HERE, 'cases');

async function loadAnswerer() {
  const ref = process.env.VERDANT_ANSWERER;
  if (!ref) return null;
  const mod = await import(resolve(ref));
  if (typeof mod.answer !== 'function') throw new Error(`${ref} must export answer(question, bundle)`);
  return mod.answer;
}

const cases = readdirSync(CASES_DIR).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(CASES_DIR, f), 'utf8')));
const answerer = await loadAnswerer();

let pass = 0, fail = 0;
const ok = (cond, msg) => { cond ? (pass++, console.log(`  ok   ${msg}`)) : (fail++, console.log(`  FAIL ${msg}`)); };

console.log('Groundedness evals');
console.log(answerer ? '(answerer wired — testing real output)\n' : '(no answerer wired — running checker self-tests only)\n');

for (const c of cases) {
  console.log(`[case] ${c.id}`);
  const bundle = JSON.parse(readFileSync(resolve(CASES_DIR, c.bundle), 'utf8'));
  const numbers = bundleNumbers(bundle);

  // 1. The checker must work: grounded exemplar passes, fabricated exemplar is caught.
  ok(ungroundedNumbers(c.good_answer, numbers).length === 0, `${c.id}: good_answer is grounded`);
  const badHits = ungroundedNumbers(c.bad_answer, numbers);
  ok(badHits.length > 0, `${c.id}: bad_answer flagged (caught ${JSON.stringify(badHits)})`);

  // 2. The values a correct answer should surface are actually in this bundle.
  for (const v of c.must_reference ?? []) ok(numbers.some((b) => Math.abs(b - v) < 1e-9), `${c.id}: bundle contains ${v}`);

  // 3. If an answerer is wired, ground-check its real output — numbers AND named entities, via the
  //    same checker the runtime guardrail uses.
  if (answerer) {
    const out = await answerer(c.question, bundle);
    const g = checkGrounding(out, bundle);
    const bad = [...g.unverifiedNumbers, ...g.unverifiedEntities];
    ok(bad.length === 0, `${c.id}: answerer output is grounded${bad.length ? ` (ungrounded: ${JSON.stringify(bad)})` : ''}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
