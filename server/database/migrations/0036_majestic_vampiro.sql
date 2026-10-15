CREATE TABLE "antiquity_survey_sites" (
	"id" serial PRIMARY KEY NOT NULL,
	"survey_id" varchar(16) NOT NULL,
	"source" varchar(32) NOT NULL,
	"name" varchar(240) NOT NULL,
	"kind" varchar(24) NOT NULL,
	"period_keys" text[] DEFAULT '{}' NOT NULL,
	"period_from" integer NOT NULL,
	"period_to" integer NOT NULL,
	"period_basis" varchar(24) NOT NULL,
	"destroyed" boolean DEFAULT false NOT NULL,
	"uncertain" boolean DEFAULT false NOT NULL,
	"evidence" varchar(24),
	"geom" geometry(Point, 4326) NOT NULL,
	CONSTRAINT "antiquity_survey_sites_survey_id_unique" UNIQUE("survey_id")
);
--> statement-breakpoint
CREATE INDEX "antiquity_survey_sites_geom_idx" ON "antiquity_survey_sites" USING gist ("geom");