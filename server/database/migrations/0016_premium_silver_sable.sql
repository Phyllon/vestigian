CREATE TABLE IF NOT EXISTS "antiquity_period_extents" (
	"id" serial PRIMARY KEY NOT NULL,
	"period_year" integer NOT NULL,
	"geom" geometry(Polygon, 4326) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "antiquity_period_extents_geom_idx" ON "antiquity_period_extents" USING gist ("geom");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "antiquity_period_extents_year_idx" ON "antiquity_period_extents" USING btree ("period_year");