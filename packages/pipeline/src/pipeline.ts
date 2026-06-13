// The M0 tracer-bullet pipeline: ingest a parsed G2F study into the relational tables, assemble
// a contract AnalysisRequest FROM the database, run the R kernel, and persist the ResultBundle.
//
// The kernel is invoked as an Rscript subprocess (ADR-0012) through the runRKernel seam. `runKernel`
// is the unit that the JobQueue worker will call once the queue is wired — keeping it (and runRKernel)
// isolated means swapping "direct call" for "queued job" is a localized change, not a rewrite.
import { eq } from 'drizzle-orm';
import {
  db,
  program,
  study,
  germplasm,
  observationVariable,
  observationUnit,
  observation,
  analysisRun,
  resultBundle,
} from '@verdant/db';
import {
  validateAnalysisRequest,
  validateResultBundle,
  type AnalysisRequest,
  type ResultBundle,
} from '@verdant/contracts';
import type { ParsedStudy } from './g2f';
import { runRKernel } from './kernel';

// The override-aware MET analysis entrypoint (ADR-0018) + its types, re-exported so the web tier's
// Server Action / job queue can drive a re-run without reaching into the driver module.
export { runMetAnalysis, type RunMetOptions, type RunMetResult } from './met-build';
export { computeCombiningAbility, buildCombinedAnalysis, attachCombiningAbility, type CombiningAbility } from './combining-ability-build';
export type { ModelOverrides, ModelDecision, OverridableFactor } from './planner';

const PROGRAM_NAME = 'G2F (public dev data)';

const chunk = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

async function upsertReturningId<T extends { id: number }>(
  table: { id: unknown },
  values: Record<string, unknown>,
  selectByNatural: () => Promise<T[]>,
): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db.insert(table as any).values(values as any) as any).onConflictDoNothing();
  const [row] = await selectByNatural();
  return row.id;
}

/** Ingest one parsed G2F study into the relational tables (idempotent on natural keys). */
export async function ingestStudy(parsed: ParsedStudy): Promise<{ programId: number; studyId: number }> {
  const programId = await upsertReturningId(program, { name: PROGRAM_NAME }, () =>
    db.select().from(program).where(eq(program.name, PROGRAM_NAME)),
  );

  const studyId = await upsertReturningId(
    study,
    {
      programId,
      name: parsed.env,
      fieldLocation: parsed.fieldLocation,
      year: parsed.year,
      source: 'g2f',
    },
    () => db.select().from(study).where(eq(study.name, parsed.env)),
  );

  // Germplasm
  const hybrids = new Map(parsed.units.map((u) => [u.hybrid, u]));
  if (hybrids.size) {
    await db
      .insert(germplasm)
      .values([...hybrids.values()].map((u) => ({ programId, name: u.hybrid, parent1: u.parent1, parent2: u.parent2 })))
      .onConflictDoNothing();
  }
  const germRows = await db.select().from(germplasm).where(eq(germplasm.programId, programId));
  const germId = new Map(germRows.map((g) => [g.name, g.id]));

  // ObservationVariables
  await db
    .insert(observationVariable)
    .values(parsed.traits.map((t) => ({ programId, name: t.column, trait: t.name, unit: t.unit, dataType: 'numeric' })))
    .onConflictDoNothing();
  const varRows = await db.select().from(observationVariable).where(eq(observationVariable.programId, programId));
  const varId = new Map(varRows.map((v) => [v.name, v.id]));

  // ObservationUnits
  await db
    .insert(observationUnit)
    .values(
      parsed.units.map((u) => ({
        studyId,
        germplasmId: germId.get(u.hybrid)!,
        plotNumber: u.plot,
        replicate: u.replicate,
        block: u.block,
        row: u.row,
        col: u.col,
      })),
    )
    .onConflictDoNothing();
  const unitRows = await db.select().from(observationUnit).where(eq(observationUnit.studyId, studyId));
  const unitId = new Map(unitRows.map((u) => [u.plotNumber!, u.id]));

  // Observations (chunked — the high-volume table)
  const obsRows = parsed.observations.map((o) => ({
    observationUnitId: unitId.get(o.plot)!,
    variableId: varId.get(o.column)!,
    value: o.value,
  }));
  for (const part of chunk(obsRows, 1000)) {
    await db.insert(observation).values(part).onConflictDoNothing();
  }

  return { programId, studyId };
}

/** The selection objective, exactly as the contract defines it (gates + index weights). */
export type ObjectiveSpec = NonNullable<AnalysisRequest['objective']>;

/** Assemble a contract AnalysisRequest from the persisted study. Validates before returning. */
export async function buildRequestFromDb(
  studyId: number,
  opts: { analyzeColumns: string[]; objective?: ObjectiveSpec; segmentId?: string },
): Promise<AnalysisRequest> {
  const [s] = await db.select().from(study).where(eq(study.id, studyId));
  const units = await db.select().from(observationUnit).where(eq(observationUnit.studyId, studyId));
  const germRows = await db.select().from(germplasm).where(eq(germplasm.programId, s.programId));
  const germName = new Map(germRows.map((g) => [g.id, g.name]));
  const varRows = await db.select().from(observationVariable).where(eq(observationVariable.programId, s.programId));
  const varById = new Map(varRows.map((v) => [v.id, v]));
  const analyzeIds = new Set(varRows.filter((v) => opts.analyzeColumns.includes(v.name)).map((v) => v.id));

  const unitById = new Map(units.map((u) => [u.id, u]));
  const allObs = await db.select().from(observation);
  const obsForStudy = allObs.filter((o) => unitById.has(o.observationUnitId) && analyzeIds.has(o.variableId));

  const request: AnalysisRequest = {
    contract_version: 'v0',
    analysis_request_id: `${s.name}-m0`,
    intent: 'selection',
    scope: opts.segmentId ? { segment_id: opts.segmentId, is_discovery: false } : undefined,
    // casts: the schema requires >=1 item (a non-empty tuple type); these are always non-empty
    // for a persisted study, and validateAnalysisRequest below is the authoritative guard.
    variables: varRows
      .filter((v) => opts.analyzeColumns.includes(v.name))
      .map((v) => ({ variable_id: v.name, name: v.trait ?? v.name, data_type: 'numeric' as const, unit: v.unit ?? null, analyze: true })) as AnalysisRequest['variables'],
    observation_units: units.map((u) => ({
      observation_unit_id: String(u.plotNumber),
      germplasm_id: germName.get(u.germplasmId)!,
      environment_id: s.name,
      layout: { row: u.row, col: u.col, rep: u.replicate, block: u.block },
    })) as AnalysisRequest['observation_units'],
    observations: obsForStudy.map((o) => ({
      observation_unit_id: String(unitById.get(o.observationUnitId)!.plotNumber),
      variable_id: varById.get(o.variableId)!.name,
      value: o.value,
    })),
    design: { is_multi_environment: false },
    relationship: { type: 'identity' },
    objective: opts.objective,
  };
  return validateAnalysisRequest(request);
}

/** Run the R compute kernel on a request (via the runRKernel seam). Validates the returned bundle. */
export function runKernel(request: AnalysisRequest): ResultBundle {
  return validateResultBundle(runRKernel('analyze.R', request));
}

/** Persist the run + its result bundle (the bundle stored whole as JSONB, ADR-0001). */
export async function persistResult(args: {
  programId: number;
  studyId: number;
  request: AnalysisRequest;
  bundle: ResultBundle;
}): Promise<{ analysisRunId: number }> {
  const [run] = await db
    .insert(analysisRun)
    .values({
      programId: args.programId,
      studyId: args.studyId,
      intent: args.request.intent,
      status: 'ok',
      contractVersion: 'v0',
      request: args.request,
      finishedAt: new Date(),
    })
    .returning({ id: analysisRun.id });
  await db.insert(resultBundle).values({
    analysisRunId: run.id,
    contractVersion: 'v0',
    bundle: args.bundle,
  });
  return { analysisRunId: run.id };
}
