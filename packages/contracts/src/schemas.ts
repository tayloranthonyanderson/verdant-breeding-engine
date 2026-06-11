// The JSON Schema source of truth, re-exported as importable objects so other packages
// (and the runtime validator) reference one canonical copy. Do not duplicate these shapes.
import analysisRequestSchema from '../v0/analysis-request.schema.json' with { type: 'json' };
import resultBundleSchema from '../v0/result-bundle.schema.json' with { type: 'json' };

export { analysisRequestSchema, resultBundleSchema };
