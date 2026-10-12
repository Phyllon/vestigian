CREATE TABLE "limes_sector_sightlines" (
	"sector_slug" varchar(80) PRIMARY KEY NOT NULL,
	"model_version" integer NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"summary" jsonb NOT NULL,
	"layers" jsonb NOT NULL
);
