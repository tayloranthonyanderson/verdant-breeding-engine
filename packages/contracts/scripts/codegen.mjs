// Generate TypeScript types from the JSON Schema source of truth.
// The JSON Schemas under v0/ are authoritative; these .ts types are derived so they cannot
// drift. Run: `pnpm --filter @verdant/contracts codegen`. Generated files are committed.
import { compile } from 'json-schema-to-typescript';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// [schema file, exported root type name, output file]
const targets = [
  ['v0/analysis-request.schema.json', 'AnalysisRequest', 'src/generated/analysis-request.ts'],
  ['v0/result-bundle.schema.json', 'ResultBundle', 'src/generated/result-bundle.ts'],
];

await mkdir(path.join(root, 'src/generated'), { recursive: true });

for (const [schemaRel, typeName, outRel] of targets) {
  const schema = JSON.parse(await readFile(path.join(root, schemaRel), 'utf8'));
  // json-schema-to-typescript derives the root type name from `title`, then `$id`, and only
  // falls back to the explicit name arg when both are absent. Drop them here (the JSON files
  // keep them) so the root export is our clean `typeName`. Internal $ref fragments still resolve.
  delete schema.title;
  delete schema.$id;
  const ts = await compile(schema, typeName, {
    bannerComment:
      `/* AUTO-GENERATED from ${schemaRel} — do not edit by hand.\n` +
      ` * Regenerate with: pnpm --filter @verdant/contracts codegen */`,
    additionalProperties: false,
    style: { singleQuote: true },
  });
  await writeFile(path.join(root, outRel), ts);
  console.log(`generated ${outRel}  (export ${typeName})`);
}
