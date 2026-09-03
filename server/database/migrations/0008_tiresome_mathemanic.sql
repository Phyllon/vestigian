-- Hand-corrected: `drizzle-kit generate` has no journal entry for the
-- hand-written 0000-0007 migrations, so it proposed recreating the entire
-- schema from scratch (19 tables, every enum, every index) rather than just
-- this addition. `CREATE TYPE` has no `IF NOT EXISTS` in Postgres, so the
-- generated file would have failed outright on its first line against a
-- database that already has these types. Trimmed to the actual delta — see
-- server/database/migrations/README.md.

CREATE TYPE "public"."verification_status" AS ENUM('verified', 'rejected');--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "external_id_verifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id_id" integer NOT NULL,
	"status" "verification_status" NOT NULL,
	"distance_metres" integer,
	"checked_via" varchar(40) NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "external_id_verifications" ADD CONSTRAINT "external_id_verifications_external_id_id_external_ids_id_fk" FOREIGN KEY ("external_id_id") REFERENCES "public"."external_ids"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "external_id_verifications_unique" ON "external_id_verifications" USING btree ("external_id_id","checked_via");
