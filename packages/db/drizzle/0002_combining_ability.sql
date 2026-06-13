-- Combining ability (ADR-0019 / ADR-0020): inbred-level facts + the advancement decision.
CREATE TABLE IF NOT EXISTS "inbred_line" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"program_id" bigint NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'line' NOT NULL,
	"pool" text,
	"per_se_value" double precision,
	"nctlb_resistant" integer,
	"synthetic" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "advancement_decision" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"program_id" bigint NOT NULL,
	"analysis_run_id" bigint,
	"candidate" text NOT NULL,
	"unit" text DEFAULT 'inbred' NOT NULL,
	"pool" text,
	"disposition" text NOT NULL,
	"rationale" text,
	"decided_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inbred_line" ADD CONSTRAINT "inbred_line_program_id_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "program"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "advancement_decision" ADD CONSTRAINT "advancement_decision_program_id_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "program"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "advancement_decision" ADD CONSTRAINT "advancement_decision_analysis_run_id_analysis_run_id_fk" FOREIGN KEY ("analysis_run_id") REFERENCES "analysis_run"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inbred_line_program_name_uq" ON "inbred_line" ("program_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbred_line_program_idx" ON "inbred_line" ("program_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbred_line_pool_idx" ON "inbred_line" ("program_id","pool");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "advancement_program_idx" ON "advancement_decision" ("program_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "advancement_run_idx" ON "advancement_decision" ("analysis_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "advancement_candidate_run_uq" ON "advancement_decision" ("analysis_run_id","candidate","unit");
