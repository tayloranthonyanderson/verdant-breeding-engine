// Runtime validation of the engine contract. The JSON Schema is authoritative at runtime;
// these validators are the single guard the web tier and worker use before trusting a
// request or a result bundle. The generated TS types give compile-time safety; ajv gives
// runtime safety. Both derive from the same schema, so they cannot disagree.
import Ajv2020, { type ErrorObject } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { analysisRequestSchema, resultBundleSchema } from './schemas';
import type { AnalysisRequest } from './generated/analysis-request';
import type { ResultBundle } from './generated/result-bundle';

const ajv = addFormats(new Ajv2020({ allErrors: true, strict: false }));

const validateRequest = ajv.compile<AnalysisRequest>(analysisRequestSchema);
const validateBundle = ajv.compile<ResultBundle>(resultBundleSchema);

/** Thrown when a value does not conform to a contract schema. Carries the ajv errors. */
export class ContractValidationError extends Error {
  readonly errors: ErrorObject[];
  constructor(what: string, errors: ErrorObject[] | null | undefined) {
    const detail = (errors ?? [])
      .map((e) => `  - ${e.instancePath || '(root)'} ${e.message ?? ''}`.trimEnd())
      .join('\n');
    super(`Invalid ${what}:\n${detail}`);
    this.name = 'ContractValidationError';
    this.errors = errors ?? [];
  }
}

/** Validate and narrow an unknown value to AnalysisRequest, or throw ContractValidationError. */
export function validateAnalysisRequest(data: unknown): AnalysisRequest {
  if (!validateRequest(data)) {
    throw new ContractValidationError('AnalysisRequest', validateRequest.errors);
  }
  // Cross-field constraint lifted out of the schema: a target-mode index weight must carry a
  // numeric `target`. Expressing this in JSON Schema needs if/then, which makes the codegen drop
  // the typed properties — so we keep the schema flat (strong generated types) and enforce the
  // one conditional here, at the authoritative runtime guard. (The kernel also degrades a
  // target-without-value to 'max' so a malformed objective never aborts a run.)
  const weights = (data as AnalysisRequest).objective?.index_weights ?? [];
  weights.forEach((w, i) => {
    if (w.mode === 'target' && typeof w.target !== 'number') {
      throw new ContractValidationError('AnalysisRequest', [
        {
          instancePath: `/objective/index_weights/${i}/target`,
          keyword: 'required',
          schemaPath: '',
          params: {},
          message: "mode 'target' requires a numeric 'target' value",
        } as ErrorObject,
      ]);
    }
  });
  return data;
}

/** Validate and narrow an unknown value to ResultBundle, or throw ContractValidationError. */
export function validateResultBundle(data: unknown): ResultBundle {
  if (!validateBundle(data)) {
    throw new ContractValidationError('ResultBundle', validateBundle.errors);
  }
  return data;
}

/** Non-throwing type guard for AnalysisRequest. */
export function isAnalysisRequest(data: unknown): data is AnalysisRequest {
  return validateRequest(data);
}

/** Non-throwing type guard for ResultBundle. */
export function isResultBundle(data: unknown): data is ResultBundle {
  return validateBundle(data);
}
