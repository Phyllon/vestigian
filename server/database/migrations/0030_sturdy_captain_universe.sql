CREATE TYPE "public"."antiquity_monument_kind" AS ENUM('theatre', 'amphitheatre', 'villa', 'aqueduct', 'bridge', 'temple', 'fort', 'bath', 'forum', 'mithraeum');--> statement-breakpoint
CREATE TYPE "public"."antiquity_road_certainty" AS ENUM('certain', 'conjectured', 'hypothetical');--> statement-breakpoint
CREATE TABLE "antiquity_mints" (
	"id" serial PRIMARY KEY NOT NULL,
	"nomisma_id" varchar(120) NOT NULL,
	"name" varchar(240) NOT NULL,
	"pleiades_id" varchar(24),
	"geom" geometry(Point, 4326) NOT NULL,
	CONSTRAINT "antiquity_mints_nomisma_id_unique" UNIQUE("nomisma_id")
);
--> statement-breakpoint
CREATE TABLE "antiquity_monuments" (
	"id" serial PRIMARY KEY NOT NULL,
	"wikidata_id" varchar(24) NOT NULL,
	"name" varchar(240) NOT NULL,
	"kind" "antiquity_monument_kind" NOT NULL,
	"geom" geometry(Point, 4326) NOT NULL,
	CONSTRAINT "antiquity_monuments_wikidata_id_unique" UNIQUE("wikidata_id")
);
--> statement-breakpoint
CREATE TABLE "antiquity_polities" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"from_year" integer NOT NULL,
	"to_year" integer NOT NULL,
	"wikidata_id" varchar(24),
	"wikipedia_title" varchar(240),
	"area_square_kilometres" integer,
	"geom" geometry(MultiPolygon, 4326) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "antiquity_roman_roads" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(240),
	"is_main" boolean DEFAULT false NOT NULL,
	"certainty" "antiquity_road_certainty" NOT NULL,
	"itinerary" varchar(160),
	"citation" varchar(300),
	"bibliography" varchar(400),
	"geom" geometry(MultiLineString, 4326) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "isicily_inscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"isicily_id" varchar(16) NOT NULL,
	"title" text NOT NULL,
	"language" varchar(8),
	"inscription_function" varchar(60),
	"object_type" varchar(80),
	"material" varchar(80),
	"date_text" text,
	"not_before" integer,
	"not_after" integer,
	"place_name" varchar(160),
	"ancient_place_name" varchar(160),
	"pleiades_id" varchar(24),
	"geonames_url" varchar(300),
	"repository" varchar(240),
	"provenance" text,
	"edition" text,
	"translation" text,
	"trismegistos_id" varchar(24),
	"edcs_id" varchar(24),
	"edr_id" varchar(24),
	"licence" varchar(24) NOT NULL,
	"source_url" varchar(300) NOT NULL,
	"geom" geometry(Point, 4326),
	CONSTRAINT "isicily_inscriptions_isicily_id_unique" UNIQUE("isicily_id")
);
--> statement-breakpoint
CREATE INDEX "antiquity_mints_geom_idx" ON "antiquity_mints" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "antiquity_monuments_geom_idx" ON "antiquity_monuments" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "antiquity_monuments_kind_idx" ON "antiquity_monuments" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "antiquity_polities_geom_idx" ON "antiquity_polities" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "antiquity_polities_years_idx" ON "antiquity_polities" USING btree ("from_year","to_year");--> statement-breakpoint
CREATE INDEX "antiquity_roman_roads_geom_idx" ON "antiquity_roman_roads" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "isicily_inscriptions_geom_idx" ON "isicily_inscriptions" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "isicily_inscriptions_function_idx" ON "isicily_inscriptions" USING btree ("inscription_function");