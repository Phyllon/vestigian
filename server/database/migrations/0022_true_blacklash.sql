CREATE TABLE IF NOT EXISTS "inscription_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"inscription_id" integer NOT NULL,
	"edh_photo_id" varchar(16) NOT NULL,
	"rights_statement" varchar(200) NOT NULL,
	"rights_holder" varchar(200),
	"mirrored" boolean DEFAULT false NOT NULL,
	"storage_key" varchar(300),
	"source_url" varchar(300) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"edh_id" varchar(16) NOT NULL,
	"trismegistos_text_id" varchar(16),
	"title" varchar(200) NOT NULL,
	"inscription_type" varchar(80),
	"object_type" varchar(80),
	"material" varchar(120),
	"decorated" boolean DEFAULT false NOT NULL,
	"decoration_note" text,
	"height_cm" numeric,
	"width_cm" numeric,
	"depth_cm" numeric,
	"letter_height_cm" varchar(32),
	"origin_place_name" varchar(200),
	"origin_trismegistos_id" varchar(32),
	"province_name" varchar(120),
	"not_before" integer,
	"not_after" integer,
	"dating_method" varchar(120),
	"find_modern_place" varchar(200),
	"find_modern_country_code" varchar(2),
	"text_diplomatic" text,
	"text_edition" jsonb,
	"commentary" text,
	"bibliography" text[],
	"source_url" varchar(300) NOT NULL,
	"licence" varchar(40) DEFAULT 'CC-BY-SA-4.0' NOT NULL,
	"geom" geometry(Point, 4326),
	CONSTRAINT "inscriptions_edh_id_unique" UNIQUE("edh_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inscription_images" ADD CONSTRAINT "inscription_images_inscription_id_inscriptions_id_fk" FOREIGN KEY ("inscription_id") REFERENCES "public"."inscriptions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inscriptions_geom_idx" ON "inscriptions" USING gist ("geom");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inscriptions_trismegistos_idx" ON "inscriptions" USING btree ("origin_trismegistos_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inscriptions_type_idx" ON "inscriptions" USING btree ("inscription_type");