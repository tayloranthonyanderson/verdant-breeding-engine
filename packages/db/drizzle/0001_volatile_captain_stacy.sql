CREATE TABLE "call_set" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "call_set_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"variant_set_id" bigint NOT NULL,
	"sample_id" bigint NOT NULL,
	"dosages" "bytea" NOT NULL,
	"call_rate" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sample" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sample_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"germplasm_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variant" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "variant_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"variant_set_id" bigint NOT NULL,
	"idx" integer NOT NULL,
	"name" text,
	"chrom" text,
	"pos" bigint,
	"allele_ref" text,
	"allele_alt" text,
	"maf" double precision,
	"call_rate" double precision
);
--> statement-breakpoint
CREATE TABLE "variant_set" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "variant_set_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"crop" text,
	"platform" text,
	"genome_build" text,
	"encoding" text DEFAULT 'dosage_u8' NOT NULL,
	"n_variants" integer,
	"n_call_sets" integer,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_set" ADD CONSTRAINT "call_set_variant_set_id_variant_set_id_fk" FOREIGN KEY ("variant_set_id") REFERENCES "public"."variant_set"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_set" ADD CONSTRAINT "call_set_sample_id_sample_id_fk" FOREIGN KEY ("sample_id") REFERENCES "public"."sample"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sample" ADD CONSTRAINT "sample_germplasm_id_germplasm_id_fk" FOREIGN KEY ("germplasm_id") REFERENCES "public"."germplasm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant" ADD CONSTRAINT "variant_variant_set_id_variant_set_id_fk" FOREIGN KEY ("variant_set_id") REFERENCES "public"."variant_set"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "call_set_set_sample_uq" ON "call_set" USING btree ("variant_set_id","sample_id");--> statement-breakpoint
CREATE INDEX "call_set_sample_idx" ON "call_set" USING btree ("sample_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sample_name_uq" ON "sample" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "variant_set_idx_uq" ON "variant" USING btree ("variant_set_id","idx");--> statement-breakpoint
CREATE INDEX "variant_set_pos_idx" ON "variant" USING btree ("variant_set_id","chrom","pos");--> statement-breakpoint
CREATE UNIQUE INDEX "variant_set_name_uq" ON "variant_set" USING btree ("name");