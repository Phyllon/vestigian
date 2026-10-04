CREATE TYPE "public"."hillfort_reliability" AS ENUM('confirmed', 'unconfirmed', 'irreconciled');--> statement-breakpoint
CREATE TABLE "antiquity_hillforts" (
	"id" serial PRIMARY KEY NOT NULL,
	"atlas_number" varchar(8) NOT NULL,
	"name" varchar(240) NOT NULL,
	"country" varchar(40) NOT NULL,
	"reliability" "hillfort_reliability" NOT NULL,
	"types" text[] DEFAULT '{}' NOT NULL,
	"dated_periods" text[] DEFAULT '{}' NOT NULL,
	"area_hectares" numeric(10, 3),
	"altitude_metres" integer,
	"geom" geometry(Point, 4326) NOT NULL,
	CONSTRAINT "antiquity_hillforts_atlas_number_unique" UNIQUE("atlas_number")
);
--> statement-breakpoint
CREATE INDEX "antiquity_hillforts_geom_idx" ON "antiquity_hillforts" USING gist ("geom");