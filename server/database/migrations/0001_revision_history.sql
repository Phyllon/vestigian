-- Edit support.
--
-- A revision now records what it replaced and why. Storing the previous payload
-- on the revision rather than reconstructing it by replaying history means a
-- diff is one row read, and a revert does not depend on every intermediate
-- revision still being intact.

ALTER TABLE "revisions" ADD COLUMN "previous_payload" jsonb;
ALTER TABLE "revisions" ADD COLUMN "edit_summary" text;

-- Set when a revision restores an earlier one, so a revert is distinguishable
-- from an ordinary edit that happens to reinstate old values.
ALTER TABLE "revisions" ADD COLUMN "reverts_revision_id" integer
  REFERENCES "revisions" ("id") ON DELETE SET NULL;

-- The history view reads every revision for one record, newest first.
CREATE INDEX "revisions_history_idx"
  ON "revisions" ("entity_type", "entity_id", "created_at" DESC);
