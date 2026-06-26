// Verdant relational schema — BrAPI-aligned (ADR-0007), the canonical data model implemented
// incrementally (DOMAIN-MODEL §8: "map the territory, lay track only where we drive").
//
// THIS FILE = Milestone 0 + light Germplasm: the containment spine Program > Study >
// ObservationUnit > Observation, plus Germplasm and ObservationVariable, plus the analysis
// layer (AnalysisRun + ResultBundle stored whole as JSONB, ADR-0001).
//
// Scale posture (the author's requirement — efficient interaction with large tables):
//   - bigint identity primary keys throughout: compact, index-efficient, and the right shape
//     for the high-cardinality tables coming later (observation today; genotyping `call` at
//     M6, which is billions of rows). UUID public ids can be layered on for API exposure later.
//   - the high-volume tables (observation; later call/variant) carry explicit indexes on their
//     join/filter columns and are the natural future partition targets (by study / variant_set).
//   - genomics (Sample/CallSet/Variant/Call), pedigree, lists, operations etc. are MAPPED, not
//     built (DOMAIN-MODEL §4); they attach to these same keys without reshaping what's here.
import {
  pgTable,
  bigint,
  text,
  integer,
  doublePrecision,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  customType,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

const id = () => bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey();
const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).defaultNow().notNull();

/** Postgres bytea ↔ Node Buffer — the packed genotype dosage vector (ADR-0017). */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

/** Breeding program — the tenant-scoping root (ADR-0005). Everything hangs off a program. */
export const program = pgTable(
  'program',
  {
    id: id(),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('program_name_uq').on(t.name)],
);

/** Study — one experiment at one Location × Season (a G2F `Env`); breeders call this a "trial". */
export const study = pgTable(
  'study',
  {
    id: id(),
    programId: bigint('program_id', { mode: 'number' })
      .notNull()
      .references(() => program.id),
    name: text('name').notNull(), // e.g. "OHH1_2019"
    fieldLocation: text('field_location'), // e.g. "OHH1"
    year: integer('year'),
    season: text('season'),
    source: text('source'), // provenance, e.g. "g2f"
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('study_program_name_uq').on(t.programId, t.name),
    index('study_program_idx').on(t.programId),
  ],
);

/** Germplasm — the genotype/entry evaluated (BrAPI Germplasm). Light in M0; pedigree/A-matrix at M5. */
export const germplasm = pgTable(
  'germplasm',
  {
    id: id(),
    programId: bigint('program_id', { mode: 'number' })
      .notNull()
      .references(() => program.id),
    name: text('name').notNull(), // e.g. "M0088/LH185"
    parent1: text('parent1'),
    parent2: text('parent2'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('germplasm_program_name_uq').on(t.programId, t.name),
    index('germplasm_program_idx').on(t.programId),
  ],
);

/** ObservationVariable = Trait × Method × Scale (BrAPI-Phenotyping): the measurable. */
export const observationVariable = pgTable(
  'observation_variable',
  {
    id: id(),
    programId: bigint('program_id', { mode: 'number' })
      .notNull()
      .references(() => program.id),
    name: text('name').notNull(), // e.g. "Yield_Mg_ha"
    trait: text('trait'),
    method: text('method'),
    scale: text('scale'),
    unit: text('unit'), // e.g. "Mg/ha"
    dataType: text('data_type').notNull().default('numeric'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('obsvar_program_name_uq').on(t.programId, t.name)],
);

/** ObservationUnit — a plot (or plant). Carries the AS-PLANTED layout position (ADR-0006). */
export const observationUnit = pgTable(
  'observation_unit',
  {
    id: id(),
    studyId: bigint('study_id', { mode: 'number' })
      .notNull()
      .references(() => study.id),
    germplasmId: bigint('germplasm_id', { mode: 'number' })
      .notNull()
      .references(() => germplasm.id),
    plotNumber: integer('plot_number'),
    replicate: text('replicate'),
    block: text('block'),
    row: integer('row'), // spatial Y — from G2F `Range`
    col: integer('col'), // spatial X — from G2F `Pass`
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('obsunit_study_plot_uq').on(t.studyId, t.plotNumber),
    index('obsunit_study_idx').on(t.studyId),
    index('obsunit_germplasm_idx').on(t.germplasmId),
  ],
);

/** Observation — one measured value (long format). The current high-volume table. */
export const observation = pgTable(
  'observation',
  {
    id: id(),
    observationUnitId: bigint('observation_unit_id', { mode: 'number' })
      .notNull()
      .references(() => observationUnit.id),
    variableId: bigint('variable_id', { mode: 'number' })
      .notNull()
      .references(() => observationVariable.id),
    value: doublePrecision('value'), // numeric measurement
    valueText: text('value_text'), // categorical / raw, when not numeric
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('obs_unit_var_uq').on(t.observationUnitId, t.variableId),
    index('obs_unit_idx').on(t.observationUnitId),
    index('obs_var_idx').on(t.variableId),
  ],
);

/** AnalysisRun — one engine execution; records intent + the request, and tracks status (ADR-0002). */
export const analysisRun = pgTable(
  'analysis_run',
  {
    id: id(),
    programId: bigint('program_id', { mode: 'number' })
      .notNull()
      .references(() => program.id),
    studyId: bigint('study_id', { mode: 'number' }).references(() => study.id),
    intent: text('intent').notNull(), // selection | comparison | prediction
    status: text('status').notNull().default('queued'), // queued|running|ok|error
    contractVersion: text('contract_version').notNull().default('v0'),
    request: jsonb('request').notNull(), // the AnalysisRequest (engine contract)
    error: text('error'),
    createdAt: createdAt(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('analysisrun_program_idx').on(t.programId),
    index('analysisrun_study_idx').on(t.studyId),
  ],
);

/** ResultBundle — the whole result object (JSONB), rendered by the GUI and queried by the AI. */
export const resultBundle = pgTable(
  'result_bundle',
  {
    id: id(),
    analysisRunId: bigint('analysis_run_id', { mode: 'number' })
      .notNull()
      .references(() => analysisRun.id),
    contractVersion: text('contract_version').notNull(),
    bundle: jsonb('bundle').notNull(), // the ResultBundle (engine contract)
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('resultbundle_run_uq').on(t.analysisRunId)],
);

// --- Combining ability (ADR-0019 / ADR-0020) -------------------------------------------------
// An InbredLine carries the PARENT-level facts the hybrid trial cannot: which heterotic POOL the
// line sits in (drives within-pool GCA ranking — ADR-0020), its per-se performance (the source of
// the per-se↔GCA divergence), and directly-observed NATIVE-TRAIT calls (e.g. a major-gene disease
// resistance) used to GATE inbred advancement. These are inbred-level values keyed to the same
// parent name the germplasm.parent1/parent2 columns reference. G2F has none of this (its markers
// are a hybrid build; its phenotypes are hybrid-level), so for the maize dev set this table is
// seeded SYNTHETICALLY (ADR-0020) purely to wire the engine + UI; real maize inbred data replaces
// it later. Keyed by (program, name) so it joins to cross parentage by name.
export const inbredLine = pgTable(
  'inbred_line',
  {
    id: id(),
    programId: bigint('program_id', { mode: 'number' })
      .notNull()
      .references(() => program.id),
    name: text('name').notNull(), // the inbred's name — matches germplasm.parent1 / parent2
    role: text('role').notNull().default('line'), // 'line' (selection candidate) | 'tester' (tool)
    pool: text('pool'), // heterotic group, e.g. 'A' | 'B'; null for testers
    perSeValue: doublePrecision('per_se_value'), // synthetic per-se phenotype (yield), genetic-sd scale
    nctlbResistant: integer('nctlb_resistant'), // legacy: 1 if carries the Ht1 favorable allele (derived from loci)
    loci: jsonb('loci'), // homozygous allele per major-gene locus, e.g. {"Ht1":"Ht1","Rcg1":"rcg1",...} — the marker-gate source
    synthetic: integer('synthetic').notNull().default(1), // 1 = scaffolding data (ADR-0020), not real
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('inbred_line_program_name_uq').on(t.programId, t.name),
    index('inbred_line_program_idx').on(t.programId),
    index('inbred_line_pool_idx').on(t.programId, t.pool),
  ],
);

// --- AdvancementDecision (DOMAIN-MODEL §4) — the recorded staging move that closes the analysis→
// select→advance arc. Pulled forward (lightweight) so the combining-ability workspace can record a
// real, queryable decision per candidate × pool, sourced from the analysis it was made on.
export const advancementDecision = pgTable(
  'advancement_decision',
  {
    id: id(),
    programId: bigint('program_id', { mode: 'number' })
      .notNull()
      .references(() => program.id),
    analysisRunId: bigint('analysis_run_id', { mode: 'number' }).references(() => analysisRun.id),
    candidate: text('candidate').notNull(), // inbred (GCA) or hybrid name
    unit: text('unit').notNull().default('inbred'), // 'inbred' | 'hybrid'
    pool: text('pool'), // heterotic group of the candidate (inbred case)
    disposition: text('disposition').notNull(), // 'advance' | 'hold' | 'drop' | 'recycle-as-parent'
    rationale: text('rationale'),
    decidedBy: text('decided_by'),
    createdAt: createdAt(),
  },
  (t) => [
    index('advancement_program_idx').on(t.programId),
    index('advancement_run_idx').on(t.analysisRunId),
    uniqueIndex('advancement_candidate_run_uq').on(t.analysisRunId, t.candidate, t.unit),
  ],
);

// --- Genotyping layer (ADR-0017) — BrAPI VariantSet / Variant / Sample / CallSet -------------
// Each marker panel/platform is a VariantSet — the crop/platform heterogeneity axis (a maize 437k
// hybrid VCF, a maize GBS run, an Illumina array all coexist as separate sets). A line's dosages
// are stored PACKED on its CallSet (one byte per variant: 0/1/2, 255=missing, ordered by
// variant.idx), LZ4/TOAST-compressed by Postgres — compact + fast to bulk-load for genomic
// prediction. The BrAPI long `call` form (one row per variant×callset) is the canonical contract
// and the BigQuery target; in the Postgres tier it is a DERIVABLE VIEW over these blobs, not a
// stored billions-row table. Packed is a swappable physical layer; the long model is the contract.

/** VariantSet — one marker panel / genotyping platform / build. The heterogeneity scaling axis. */
export const variantSet = pgTable(
  'variant_set',
  {
    id: id(),
    name: text('name').notNull(), // e.g. "G2F 2014-2023 hybrids (437k, competition VCF)"
    crop: text('crop'), // e.g. "maize" — lets many crops coexist
    platform: text('platform'), // e.g. "TASSEL hybrid build", "Illumina 50K", "GBS"
    genomeBuild: text('genome_build'), // reference assembly the positions are on
    encoding: text('encoding').notNull().default('dosage_u8'), // 1 byte/variant: 0,1,2; 255=missing
    nVariants: integer('n_variants'),
    nCallSets: integer('n_call_sets'),
    source: text('source'), // provenance (DOI / file)
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('variant_set_name_uq').on(t.name)],
);

/** Variant — one marker (SNP) in a set. `idx` is its ordinal position in the packed dosage vector. */
export const variant = pgTable(
  'variant',
  {
    id: id(),
    variantSetId: bigint('variant_set_id', { mode: 'number' })
      .notNull()
      .references(() => variantSet.id),
    idx: integer('idx').notNull(), // position in the CallSet dosage byte vector
    name: text('name'), // SNP id (VCF ID, e.g. "S1_120931")
    chrom: text('chrom'),
    pos: bigint('pos', { mode: 'number' }),
    alleleRef: text('allele_ref'),
    alleleAlt: text('allele_alt'),
    maf: doublePrecision('maf'), // QC stats, filled on ingest
    callRate: doublePrecision('call_rate'),
  },
  (t) => [
    uniqueIndex('variant_set_idx_uq').on(t.variantSetId, t.idx),
    index('variant_set_pos_idx').on(t.variantSetId, t.chrom, t.pos),
  ],
);

/** Sample — a genotyped biological entry (here, a hybrid). Maps to germplasm when identified. */
export const sample = pgTable(
  'sample',
  {
    id: id(),
    name: text('name').notNull(), // line/hybrid name as in the VCF (e.g. "2369/DK3IIH6")
    germplasmId: bigint('germplasm_id', { mode: 'number' }).references(() => germplasm.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('sample_name_uq').on(t.name)],
);

/** CallSet — one sample's genotype within one VariantSet. Holds the PACKED dosage vector. */
export const callSet = pgTable(
  'call_set',
  {
    id: id(),
    variantSetId: bigint('variant_set_id', { mode: 'number' })
      .notNull()
      .references(() => variantSet.id),
    sampleId: bigint('sample_id', { mode: 'number' })
      .notNull()
      .references(() => sample.id),
    dosages: bytea('dosages').notNull(), // length = variantSet.nVariants, ordered by variant.idx
    callRate: doublePrecision('call_rate'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('call_set_set_sample_uq').on(t.variantSetId, t.sampleId),
    index('call_set_sample_idx').on(t.sampleId),
  ],
);

// --- relations (for ergonomic relational queries) -------------------------------------------
export const programRelations = relations(program, ({ many }) => ({
  studies: many(study),
  germplasm: many(germplasm),
}));
export const studyRelations = relations(study, ({ one, many }) => ({
  program: one(program, { fields: [study.programId], references: [program.id] }),
  observationUnits: many(observationUnit),
}));
export const germplasmRelations = relations(germplasm, ({ one, many }) => ({
  program: one(program, { fields: [germplasm.programId], references: [program.id] }),
  observationUnits: many(observationUnit),
}));
export const observationUnitRelations = relations(observationUnit, ({ one, many }) => ({
  study: one(study, { fields: [observationUnit.studyId], references: [study.id] }),
  germplasm: one(germplasm, {
    fields: [observationUnit.germplasmId],
    references: [germplasm.id],
  }),
  observations: many(observation),
}));
export const observationRelations = relations(observation, ({ one }) => ({
  observationUnit: one(observationUnit, {
    fields: [observation.observationUnitId],
    references: [observationUnit.id],
  }),
  variable: one(observationVariable, {
    fields: [observation.variableId],
    references: [observationVariable.id],
  }),
}));
export const analysisRunRelations = relations(analysisRun, ({ one }) => ({
  study: one(study, { fields: [analysisRun.studyId], references: [study.id] }),
  result: one(resultBundle, {
    fields: [analysisRun.id],
    references: [resultBundle.analysisRunId],
  }),
}));
export const resultBundleRelations = relations(resultBundle, ({ one }) => ({
  analysisRun: one(analysisRun, {
    fields: [resultBundle.analysisRunId],
    references: [analysisRun.id],
  }),
}));
export const variantSetRelations = relations(variantSet, ({ many }) => ({
  variants: many(variant),
  callSets: many(callSet),
}));
export const variantRelations = relations(variant, ({ one }) => ({
  variantSet: one(variantSet, { fields: [variant.variantSetId], references: [variantSet.id] }),
}));
export const sampleRelations = relations(sample, ({ one, many }) => ({
  germplasm: one(germplasm, { fields: [sample.germplasmId], references: [germplasm.id] }),
  callSets: many(callSet),
}));
export const callSetRelations = relations(callSet, ({ one }) => ({
  variantSet: one(variantSet, { fields: [callSet.variantSetId], references: [variantSet.id] }),
  sample: one(sample, { fields: [callSet.sampleId], references: [sample.id] }),
}));
