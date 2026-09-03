CREATE TABLE IF NOT EXISTS "tabula_peutingeriana_places" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" varchar(40) NOT NULL,
	"label" varchar(200) NOT NULL,
	"modern_name" varchar(200),
	"symbol" varchar(16),
	"geom" geometry(Point, 4326) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tabula_peutingeriana_roads" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" varchar(80) NOT NULL,
	"from_place_id" integer NOT NULL,
	"to_place_id" integer NOT NULL,
	"distance_roman_miles" integer,
	"is_reconstructed" boolean DEFAULT false NOT NULL,
	"over_water" boolean DEFAULT false NOT NULL,
	"crosses_mountains" boolean DEFAULT false NOT NULL,
	"crosses_river" varchar(120),
	"geom" geometry(LineString, 4326) NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tabula_peutingeriana_roads" ADD CONSTRAINT "tabula_peutingeriana_roads_from_place_id_tabula_peutingeriana_places_id_fk" FOREIGN KEY ("from_place_id") REFERENCES "public"."tabula_peutingeriana_places"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tabula_peutingeriana_roads" ADD CONSTRAINT "tabula_peutingeriana_roads_to_place_id_tabula_peutingeriana_places_id_fk" FOREIGN KEY ("to_place_id") REFERENCES "public"."tabula_peutingeriana_places"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tp_places_source_idx" ON "tabula_peutingeriana_places" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tp_places_geom_idx" ON "tabula_peutingeriana_places" USING gist ("geom");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tp_roads_source_idx" ON "tabula_peutingeriana_roads" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tp_roads_geom_idx" ON "tabula_peutingeriana_roads" USING gist ("geom");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tp_roads_from_idx" ON "tabula_peutingeriana_roads" USING btree ("from_place_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tp_roads_to_idx" ON "tabula_peutingeriana_roads" USING btree ("to_place_id");