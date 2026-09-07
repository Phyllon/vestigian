CREATE TYPE "public"."antiquity_route_kind" AS ENUM('road', 'coastal', 'overseas', 'upstream', 'downstream', 'ferry');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "antiquity_ports" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_row_id" varchar(20) NOT NULL,
	"title" text NOT NULL,
	"modern_name" text,
	"country" varchar(150),
	"foundation" varchar(200),
	"pleiades_url" varchar(500),
	"wikipedia_url" varchar(500),
	"geom" geometry(Point, 4326) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "antiquity_routes" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_node_id" integer NOT NULL,
	"target_node_id" integer NOT NULL,
	"source_title" varchar(200),
	"target_title" varchar(200),
	"route_type" "antiquity_route_kind" NOT NULL,
	"geom" geometry(LineString, 4326) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "antiquity_ports_source_row_idx" ON "antiquity_ports" USING btree ("source_row_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "antiquity_ports_geom_idx" ON "antiquity_ports" USING gist ("geom");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "antiquity_routes_geom_idx" ON "antiquity_routes" USING gist ("geom");