CREATE TABLE IF NOT EXISTS "cities" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"country_code" varchar(2) NOT NULL,
	"population" integer DEFAULT 0 NOT NULL,
	"geom" geometry(Point, 4326) NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cities_geom_idx" ON "cities" USING gist ("geom");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cities_population_idx" ON "cities" USING btree ("population");--> statement-breakpoint
-- Not representable in the drizzle schema (see the docstring on `cities` in
-- server/database/schema/geo.ts) for the same reason "sites_title_trgm_idx"
-- isn't either: drizzle-kit cannot emit an opclass index. pg_trgm is already
-- enabled by 0000_initial.sql.
CREATE INDEX IF NOT EXISTS "cities_name_trgm_idx" ON "cities" USING gin ("name" gin_trgm_ops);