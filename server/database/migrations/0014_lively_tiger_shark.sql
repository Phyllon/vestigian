CREATE TABLE IF NOT EXISTS "column_relief_plates" (
	"id" serial PRIMARY KEY NOT NULL,
	"monument" varchar(40) NOT NULL,
	"scene_number" integer,
	"title" text NOT NULL,
	"storage_key" varchar(300) NOT NULL,
	"licence" varchar(60) NOT NULL,
	"attribution" text,
	"source_url" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "column_relief_plates_monument_idx" ON "column_relief_plates" USING btree ("monument","scene_number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "column_relief_plates_source_url_idx" ON "column_relief_plates" USING btree ("source_url");