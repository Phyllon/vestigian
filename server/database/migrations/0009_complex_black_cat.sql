CREATE TABLE IF NOT EXISTS "country_boundaries" (
	"id" serial PRIMARY KEY NOT NULL,
	"iso_a2" varchar(2) NOT NULL,
	"name" varchar(200) NOT NULL,
	"geom" geometry(Geometry, 4326) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "country_boundaries_geom_idx" ON "country_boundaries" USING gist ("geom");