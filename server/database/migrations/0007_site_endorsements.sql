-- A general, positive-only signal: "I found this useful" — open to any
-- signed-in reader, not gated on having recorded a visit through
-- `site_visits`. One row per person per site, exactly like `site_bookmarks`.
--
-- This table's privacy shape is deliberately different from `site_visits`
-- and `site_bookmarks`, not an exception to their rule so much as a
-- different rule for a different kind of fact. Those two are strictly
-- private because a visit is a location history — CLAUDE.md's field-notebook
-- section is explicit that neither row nor aggregate ever reaches a public
-- feed. An endorsement is not a location history: it carries no coordinate
-- and no timestamp anyone but its author can see. Its **count** is meant to
-- be public — "12 people found this useful" is the entire point of building
-- it — while the individual row (who, when) is exposed only to the person
-- who wrote it, the same way a bookmark is. Never attributed by name on any
-- public surface.
CREATE TABLE "site_endorsements" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "site_id" integer NOT NULL REFERENCES "sites" ("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "site_endorsements_user_site_idx" ON "site_endorsements" ("user_id", "site_id");
CREATE INDEX "site_endorsements_site_idx" ON "site_endorsements" ("site_id");
