ALTER TABLE "revisions" ADD COLUMN "sampled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "revisions" ADD COLUMN "sample_reason" varchar(20);--> statement-breakpoint
CREATE INDEX "revisions_sampled_idx" ON "revisions" USING btree ("sampled_at") WHERE "revisions"."sampled_at" IS NOT NULL;