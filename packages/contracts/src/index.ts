// @verdant/contracts — the engine contract, the seam between the web tier (TS), the compute
// kernel (R), and the solver service (Python). See ./README is at package root: ../README.md.
//
// Consumers import types for compile-time safety and validators for runtime safety:
//
//   import { validateResultBundle, type AnalysisRequest } from '@verdant/contracts';
//
export type { AnalysisRequest } from './generated/analysis-request';
export type { ResultBundle } from './generated/result-bundle';

// The rich result-bundle facet shapes (combining_ability + recycling) + their narrowing helpers —
// the one typed home both the pipeline and the web tier import (the generated bundle types these loosely).
export * from './facets';

export {
  validateAnalysisRequest,
  validateResultBundle,
  isAnalysisRequest,
  isResultBundle,
  ContractValidationError,
} from './validator';

export { analysisRequestSchema, resultBundleSchema } from './schemas';

/** The contract version these types and schemas represent. */
export const CONTRACT_VERSION = 'v0' as const;
