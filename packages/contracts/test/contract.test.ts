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

test('a request with model_overrides validates and an unknown override value is rejected', () => {
  const req = example('single-trial-request.example.json') as Record<string, unknown>;
  // a well-formed override is accepted
  const ok = validateAnalysisRequest({
    ...req,
    model_overrides: { relationship: 'G', gxe: 'include', spatial: null },
  });
  assert.equal(ok.model_overrides?.relationship, 'G');
  // an out-of-enum override value is rejected
  assert.throws(
    () => validateAnalysisRequest({ ...req, model_overrides: { relationship: 'kinship' } }),
    ContractValidationError,
  );
  // an unknown override factor is rejected (additionalProperties:false)
  assert.throws(
    () => validateAnalysisRequest({ ...req, model_overrides: { smoothing: 'on' } }),
    ContractValidationError,
  );
});

test('a bundle with overridden + refused decisions and an overridable map validates', () => {
  const bundle = example('single-trial-bundle.example.json') as Record<string, unknown>;
  const cm = (bundle.chosen_model as Record<string, unknown>);
  const merged = {
    ...bundle,
    chosen_model: {
      ...cm,
      decisions: [
        { factor: 'relationship', choice: 'identity', reason: 'Breeder kept identity.',
          source: 'overridden', recommended: 'G', feasible: true,
          evidence: { genomic_G: 0.42, pedigree_A: 0.31, identity: 0 } },
        { factor: 'gxe', choice: 'skipped', reason: 'GxE override refused.',
          source: 'overridden', recommended: 'skipped', feasible: false,
          refused_reason: 'No within-environment replication; GxE cannot be separated.' },
      ],
      overridable: [
        { factor: 'relationship', options: [
          { value: 'identity', feasible: true, reason: null },
          { value: 'G', feasible: true, reason: null },
          { value: 'A', feasible: false, reason: 'No pedigree supplied.' },
        ] },
      ],
    },
  };
  const out = validateResultBundle(merged);
  assert.equal(out.chosen_model.decisions?.[0].source, 'overridden');
  assert.equal(out.chosen_model.decisions?.[1].feasible, false);
  assert.equal(out.chosen_model.overridable?.[0].options.length, 3);
});

test('a bundle with a data_quality section + enriched Model-QC diagnostics validates', () => {
  const bundle = example('single-trial-bundle.example.json') as Record<string, unknown>;
  const traits = (bundle.traits as Array<Record<string, unknown>>).map((t, i) =>
    i === 0
      ? {
          ...t,
          diagnostics: {
            converged: true,
            n_obs: 96,
            residual_normality_p: 0.03,
            spatial_residual_autocorr: 0.18,
            h2_boundary: false,
            mean_reliability: 0.71,
            influential: [
              { observation_unit_id: 'plot-47', germplasm_id: 'G12', value: 9999, studentized_resid: 6.2 },
            ],
            reml_warnings: [],
          },
        }
      : t,
  );
  const merged = {
    ...bundle,
    traits,
    data_quality: {
      findings: [
        { check: 'outlier', severity: 'warning', detail: 'Plot-47 value 9999 is 8.1 MAD from its cell median.',
          target: { kind: 'observation_unit', id: 'plot-47' }, variable_id: 'YIELD', value: 8.1, suggested_exclusion: true },
        { check: 'duplicate_name', severity: 'info', detail: "'G12' and 'G12 ' differ only by whitespace — likely the same entry.",
          target: { kind: 'germplasm', id: 'G12', id2: 'G12 ' } },
        { check: 'missingness', severity: 'error', detail: 'Environment E3 is 62% missing for YIELD.',
          target: { kind: 'environment', id: 'E3' }, variable_id: 'YIELD', value: 0.62, suggested_exclusion: true },
      ],
      summary: { n_findings: 3, by_severity: { error: 1, warning: 1, info: 1 } },
    },
  };
  const out = validateResultBundle(merged);
  assert.equal(out.data_quality?.findings?.length, 3);
  assert.equal(out.data_quality?.findings?.[0].target.kind, 'observation_unit');
  assert.equal(out.traits[0].diagnostics?.influential?.[0].observation_unit_id, 'plot-47');
  // an unknown check value is rejected (additionalProperties + enum)
  assert.throws(
    () => validateResultBundle({ ...merged, data_quality: { findings: [{ check: 'vibes', severity: 'info', detail: 'x', target: { kind: 'dataset' } }] } }),
    ContractValidationError,
  );
});

test('a request with data_overrides validates and an unknown exclusion kind is rejected', () => {
  const req = example('single-trial-request.example.json') as Record<string, unknown>;
  const ok = validateAnalysisRequest({
    ...req,
    data_overrides: {
      exclusions: [
        { target: { kind: 'environment', id: 'E3' }, variable_id: 'YIELD', reason: 'flooded', source: 'manual' },
        { target: { kind: 'observation_unit', id: 'plot-47' }, source: 'auto_policy' },
      ],
    },
  });
  assert.equal(ok.data_overrides?.exclusions?.length, 2);
  assert.equal(ok.data_overrides?.exclusions?.[0].source, 'manual');
  assert.throws(
    () => validateAnalysisRequest({ ...req, data_overrides: { exclusions: [{ target: { kind: 'planet', id: 'x' } }] } }),
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
