CREATE TYPE "public"."antiquity_feature_kind" AS ENUM('bridge', 'mine_quarry', 'dam', 'cemetery', 'fort', 'tumulus');--> statement-breakpoint
ALTER TYPE "public"."antiquity_line_kind" ADD VALUE IF NOT EXISTS 'centuriation';--> statement-breakpoint
ALTER TYPE "public"."antiquity_line_kind" ADD VALUE IF NOT EXISTS 'causeway';--> statement-breakpoint
ALTER TYPE "public"."antiquity_line_kind" ADD VALUE IF NOT EXISTS 'dike_levee';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "antiquity_coin_hoards" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(240) NOT NULL,
	"hoard_count" integer NOT NULL,
	"geonames_url" varchar(300),
	"geom" geometry(Point, 4326) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "antiquity_features" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" "antiquity_feature_kind" NOT NULL,
	"name" varchar(240),
	"source" varchar(100),
	"material" varchar(100),
	"periods" varchar(100),
	"geom" geometry(Point, 4326) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "antiquity_coin_hoards_geom_idx" ON "antiquity_coin_hoards" USING gist ("geom");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "antiquity_features_geom_idx" ON "antiquity_features" USING gist ("geom");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "antiquity_features_kind_idx" ON "antiquity_features" USING btree ("kind");