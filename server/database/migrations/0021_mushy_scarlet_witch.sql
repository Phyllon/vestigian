CREATE TABLE IF NOT EXISTS "antiquity_empire_extents" (
	"id" serial PRIMARY KEY NOT NULL,
	"ohm_relation_id" integer NOT NULL,
	"state_name" varchar(120) NOT NULL,
	"start_year" integer NOT NULL,
	"end_year" integer NOT NULL,
	"end_event" text,
	"geom" geometry(MultiPolygon, 4326) NOT NULL
);
--> statement-breakpoint
DROP TABLE "antiquity_period_extents" CASCADE;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "antiquity_empire_extents_geom_idx" ON "antiquity_empire_extents" USING gist ("geom");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "antiquity_empire_extents_start_idx" ON "antiquity_empire_extents" USING btree ("start_year");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "antiquity_empire_extents_relation_idx" ON "antiquity_empire_extents" USING btree ("ohm_relation_id");