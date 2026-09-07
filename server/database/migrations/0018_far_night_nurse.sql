CREATE TABLE IF NOT EXISTS "antiquity_battles" (
	"id" serial PRIMARY KEY NOT NULL,
	"wikidata_id" varchar(16) NOT NULL,
	"title" varchar(300) NOT NULL,
	"year" integer NOT NULL,
	"location_precision" varchar(24) NOT NULL,
	"wikipedia_url" varchar(500),
	"geom" geometry(Point, 4326) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "antiquity_battles_wikidata_idx" ON "antiquity_battles" USING btree ("wikidata_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "antiquity_battles_geom_idx" ON "antiquity_battles" USING gist ("geom");