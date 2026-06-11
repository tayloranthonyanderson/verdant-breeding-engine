// Verdant relational schema — BrAPI-aligned (ADR-0007), the canonical data model implemented
// incrementally (DOMAIN-MODEL §8: "map the territory, lay track only where we drive").
//
// THIS FILE = Milestone 0 + light Germplasm: the containment spine Program > Study >
// ObservationUnit > Observation, plus Germplasm and ObservationVariable, plus the analysis
// layer (AnalysisRun + ResultBundle stored whole as JSONB, ADR-0001).
//
// Scale posture (founder's requirement — efficient interaction with large tables):
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
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

const id = () => bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey();
const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).defaultNow().notNull();

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
