// The TS face of the contract's test surface (mirrors validate.py for JS consumers):
// the worked examples must conform, and malformed payloads must be rejected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  validateAnalysisRequest,
  validateResultBundle,
  isAnalysisRequest,
  ContractValidationError,
} from '../src/index';

const here = path.dirname(fileURLToPath(import.meta.url));
const example = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(here, '..', 'v0', 'examples', name), 'utf8'));

test('the single-trial request example conforms', () => {
  const req = validateAnalysisRequest(example('single-trial-request.example.json'));
  assert.equal(req.contract_version, 'v0');
  assert.equal(req.intent, 'selection');
  assert.equal(req.observation_units.length, 8);
});

test('the single-trial result bundle example conforms', () => {
  const bundle = validateResultBundle(example('single-trial-bundle.example.json'));
  assert.equal(bundle.status, 'ok');
  assert.equal(bundle.chosen_model.relationship, 'identity');
  assert.equal(bundle.traits.length, 2);
  assert.equal(bundle.indices?.length, 2);
});

test('a request missing required fields is rejected', () => {
  assert.throws(
    () => validateAnalysisRequest({ contract_version: 'v0' }),
    ContractValidationError,
  );
  assert.equal(isAnalysisRequest({ contract_version: 'v0' }), false);
});

test('a request with an unknown intent is rejected', () => {
  const req = example('single-trial-request.example.json') as Record<string, unknown>;
  assert.throws(
    () => validateAnalysisRequest({ ...req, intent: 'guessing' }),
    ContractValidationError,
  );
});

test('a target-mode index weight requires a numeric target', () => {
  const req = example('single-trial-request.example.json') as Record<string, unknown>;
  const withMode = (iw: unknown) => ({ ...req, objective: { index_weights: iw } });
  // target mode without a target value is rejected (the lifted cross-field constraint)
  assert.throws(
    () => validateAnalysisRequest(withMode([{ variable_id: 'YIELD', mode: 'target', weight: 1 }])),
    ContractValidationError,
  );
  // target mode WITH a numeric target is accepted, and `direction` is now optional
  const ok = validateAnalysisRequest(
    withMode([{ variable_id: 'YIELD', mode: 'target', target: 5.0, weight: 1 }]),
  );
  assert.equal(ok.objective?.index_weights?.[0].mode, 'target');
  assert.equal(ok.objective?.index_weights?.[0].target, 5.0);
});
