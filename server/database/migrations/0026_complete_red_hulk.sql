CREATE TABLE IF NOT EXISTS "attic_inscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"aio_key" varchar(16) NOT NULL,
	"title" text NOT NULL,
	"primary_source" varchar(160),
	"date_text" varchar(120),
	"not_before" integer,
	"not_after" integer,
	"monument_type" varchar(80),
	"inscription_type" text,
	"translators" text[],
	"translation_edition" jsonb,
	"footnotes" jsonb,
	"original_location" jsonb,
	"findspots" jsonb,
	"image_credits" jsonb,
	"references" jsonb,
	"source_url" varchar(300) NOT NULL,
	"licence" varchar(40) DEFAULT 'CC-BY-SA-3.0' NOT NULL,
	"geom" geometry(Point, 4326),
	CONSTRAINT "attic_inscriptions_aio_key_unique" UNIQUE("aio_key")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attic_inscriptions_geom_idx" ON "attic_inscriptions" USING gist ("geom");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attic_inscriptions_monument_idx" ON "attic_inscriptions" USING btree ("monument_type");