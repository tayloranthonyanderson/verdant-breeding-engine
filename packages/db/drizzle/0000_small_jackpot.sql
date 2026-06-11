CREATE TABLE "analysis_run" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analysis_run_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"program_id" bigint NOT NULL,
	"study_id" bigint,
	"intent" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"contract_version" text DEFAULT 'v0' NOT NULL,
	"request" jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "germplasm" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "germplasm_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"program_id" bigint NOT NULL,
	"name" text NOT NULL,
	"parent1" text,
	"parent2" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observation" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "observation_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"observation_unit_id" bigint NOT NULL,
	"variable_id" bigint NOT NULL,
	"value" double precision,
	"value_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observation_unit" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "observation_unit_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"study_id" bigint NOT NULL,
	"germplasm_id" bigint NOT NULL,
	"plot_number" integer,
	"replicate" text,
	"block" text,
	"row" integer,
	"col" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observation_variable" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "observation_variable_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"program_id" bigint NOT NULL,
	"name" text NOT NULL,
	"trait" text,
	"method" text,
	"scale" text,
	"unit" text,
	"data_type" text DEFAULT 'numeric' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "program_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "result_bundle" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "result_bundle_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"analysis_run_id" bigint NOT NULL,
	"contract_version" text NOT NULL,
	"bundle" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "study_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"program_id" bigint NOT NULL,
	"name" text NOT NULL,
	"field_location" text,
	"year" integer,
	"season" text,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis_run" ADD CONSTRAINT "analysis_run_program_id_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."program"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_run" ADD CONSTRAINT "analysis_run_study_id_study_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."study"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "germplasm" ADD CONSTRAINT "germplasm_program_id_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."program"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_observation_unit_id_observation_unit_id_fk" FOREIGN KEY ("observation_unit_id") REFERENCES "public"."observation_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_variable_id_observation_variable_id_fk" FOREIGN KEY ("variable_id") REFERENCES "public"."observation_variable"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_unit" ADD CONSTRAINT "observation_unit_study_id_study_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."study"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_unit" ADD CONSTRAINT "observation_unit_germplasm_id_germplasm_id_fk" FOREIGN KEY ("germplasm_id") REFERENCES "public"."germplasm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_variable" ADD CONSTRAINT "observation_variable_program_id_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."program"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_bundle" ADD CONSTRAINT "result_bundle_analysis_run_id_analysis_run_id_fk" FOREIGN KEY ("analysis_run_id") REFERENCES "public"."analysis_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study" ADD CONSTRAINT "study_program_id_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."program"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analysisrun_program_idx" ON "analysis_run" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "analysisrun_study_idx" ON "analysis_run" USING btree ("study_id");--> statement-breakpoint
CREATE UNIQUE INDEX "germplasm_program_name_uq" ON "germplasm" USING btree ("program_id","name");--> statement-breakpoint
CREATE INDEX "germplasm_program_idx" ON "germplasm" USING btree ("program_id");--> statement-breakpoint
CREATE UNIQUE INDEX "obs_unit_var_uq" ON "observation" USING btree ("observation_unit_id","variable_id");--> statement-breakpoint
CREATE INDEX "obs_unit_idx" ON "observation" USING btree ("observation_unit_id");--> statement-breakpoint
CREATE INDEX "obs_var_idx" ON "observation" USING btree ("variable_id");--> statement-breakpoint
CREATE UNIQUE INDEX "obsunit_study_plot_uq" ON "observation_unit" USING btree ("study_id","plot_number");--> statement-breakpoint
CREATE INDEX "obsunit_study_idx" ON "observation_unit" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX "obsunit_germplasm_idx" ON "observation_unit" USING btree ("germplasm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "obsvar_program_name_uq" ON "observation_variable" USING btree ("program_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "program_name_uq" ON "program" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "resultbundle_run_uq" ON "result_bundle" USING btree ("analysis_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "study_program_name_uq" ON "study" USING btree ("program_id","name");--> statement-breakpoint
CREATE INDEX "study_program_idx" ON "study" USING btree ("program_id");