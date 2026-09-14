CREATE TABLE "import_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" varchar(80) NOT NULL,
	"row_count" integer NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "import_runs_source_idx" ON "import_runs" USING btree ("source","ran_at");