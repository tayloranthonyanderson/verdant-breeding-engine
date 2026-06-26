CREATE TABLE "advancement_decision" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "advancement_decision_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
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
CREATE TABLE "inbred_line" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "inbred_line_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"program_id" bigint NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'line' NOT NULL,
	"pool" text,
	"per_se_value" double precision,
	"nctlb_resistant" integer,
	"loci" jsonb,
	"synthetic" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "advancement_decision" ADD CONSTRAINT "advancement_decision_program_id_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."program"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advancement_decision" ADD CONSTRAINT "advancement_decision_analysis_run_id_analysis_run_id_fk" FOREIGN KEY ("analysis_run_id") REFERENCES "public"."analysis_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbred_line" ADD CONSTRAINT "inbred_line_program_id_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."program"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "advancement_program_idx" ON "advancement_decision" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "advancement_run_idx" ON "advancement_decision" USING btree ("analysis_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "advancement_candidate_run_uq" ON "advancement_decision" USING btree ("analysis_run_id","candidate","unit");--> statement-breakpoint
CREATE UNIQUE INDEX "inbred_line_program_name_uq" ON "inbred_line" USING btree ("program_id","name");--> statement-breakpoint
CREATE INDEX "inbred_line_program_idx" ON "inbred_line" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "inbred_line_pool_idx" ON "inbred_line" USING btree ("program_id","pool");