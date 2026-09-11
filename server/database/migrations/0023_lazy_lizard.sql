ALTER TABLE "inscriptions" ADD COLUMN "text_language" varchar(8);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inscriptions_language_idx" ON "inscriptions" USING btree ("text_language");