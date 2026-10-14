CREATE TABLE "road_audit_gaps" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" varchar(8) NOT NULL,
	"source_key" varchar(160) NOT NULL,
	"title" varchar(240) NOT NULL,
	"nearest_road_metres" integer,
	"model_version" integer NOT NULL,
	"geom" geometry(Point, 4326) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "road_audit_segments" (
	"road_id" integer PRIMARY KEY NOT NULL,
	"length_metres" integer NOT NULL,
	"edh_milestones" integer NOT NULL,
	"vici_milestones" integer NOT NULL,
	"vici_road_sites" integer NOT NULL,
	"certain_ends" integer NOT NULL,
	"steepest_gradient_percent" real,
	"terrain_coverage" real,
	"model_version" integer NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "road_audit_gaps_geom_idx" ON "road_audit_gaps" USING gist ("geom");