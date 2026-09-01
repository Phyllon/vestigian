-- The field notebook: a reader's own traces.
--
-- Everything else in this database is the shared record -- the atlas that
-- contributors build together and moderators review. These two tables are not
-- that. They are personal data about the person reading, with exactly one
-- lawful reader, and three rules follow from that which no other table here
-- has to obey:
--
-- 1. They never go through `applyRevision()`. That path exists for changes to
--    the shared record, and routing a private bookmark through the revision
--    and moderation machinery would put a moderator in front of someone's
--    travel plans. The handlers under `server/api/me/` write these tables
--    directly, and they are the only writes in the app that do.
--
-- 2. They are never joined into `/api/data/sites.geojson` or any other public
--    feed. The `antiquity_*` tables are kept out of that feed for a licence
--    reason; these are kept out for a data-protection one.
--
-- 3. They never enter the MVT pipeline. Tile invalidation in this project is a
--    single global counter (`bumpDataVersion()`), which is what makes tiles
--    cacheable for far longer than editable content normally allows. A
--    per-user layer inside `ST_AsMVT` would make every tile per-user and throw
--    that away. The map draws visits as a separate client-side GeoJSON source
--    fed by `/api/me/map.geojson` instead.
--
-- Both cascade from `users`, so `auth/account.delete.ts` erases them with the
-- account and needs no change.

-- Profile fields. `public_profile` is opt-in and defaults to false: a
-- contributor page that appeared without being asked for would publish an
-- association between a display name and a body of work that the person never
-- agreed to.
ALTER TABLE "users"
  ADD COLUMN "bio" varchar(280),
  ADD COLUMN "home_ground" varchar(64),
  ADD COLUMN "public_profile" boolean NOT NULL DEFAULT false,
  ADD COLUMN "notify_by_email" boolean NOT NULL DEFAULT true,
  ADD COLUMN "preferred_locale" varchar(5);

-- `home_ground` holds a camera hash (`{zoom}/{lat}/{lon}`) -- the same string
-- the URL fragment already carries, parsed by the same codec in
-- `useMapInstance`. Storing coordinates in three columns would be a second
-- serialisation of a format that already exists and is already tested.

CREATE TABLE "site_visits" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "site_id" integer NOT NULL REFERENCES "sites" ("id") ON DELETE CASCADE,
  -- Nullable on purpose. "I have been, I do not recall when" is a real answer,
  -- and a required date would be filled in with an invented one.
  "visited_on" date,
  -- The visitor's own note, private to them. Not a description of the site --
  -- that is what a contribution is for, and it goes through review.
  "note" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- One visit row per person per site. Revisiting updates the row rather than
-- appending: this is a record of *whether* someone has stood somewhere, not an
-- itinerary, and a log of repeat trips is a movement history worth more to an
-- attacker than it is to the person who made it.
CREATE UNIQUE INDEX "site_visits_user_site_idx" ON "site_visits" ("user_id", "site_id");
CREATE INDEX "site_visits_user_recent_idx" ON "site_visits" ("user_id", "visited_on" DESC NULLS LAST);
CREATE INDEX "site_visits_site_idx" ON "site_visits" ("site_id");

CREATE TABLE "site_bookmarks" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "site_id" integer NOT NULL REFERENCES "sites" ("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "site_bookmarks_user_site_idx" ON "site_bookmarks" ("user_id", "site_id");
CREATE INDEX "site_bookmarks_user_recent_idx" ON "site_bookmarks" ("user_id", "created_at" DESC);

-- Changing an email address is a two-step: the new address is held here until
-- its owner confirms it, and only then written to `users`. Writing it straight
-- to `users` and clearing `email_verified_at` would be simpler and much worse —
-- a typo, or someone else's address typed into a borrowed session, would lock
-- the real owner out of an account they can still see but no longer sign in to.
--
-- Null for every other token purpose, which is why it is a column here rather
-- than a table of its own.
ALTER TABLE "email_tokens" ADD COLUMN "new_email" varchar(320);
