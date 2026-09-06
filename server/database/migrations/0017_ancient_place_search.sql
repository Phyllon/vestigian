-- Not representable in the drizzle schema (see the docstring on `cities`
-- in server/database/schema/geo.ts, and "cities_name_trgm_idx" in
-- 0011_glorious_exodus.sql) for the same reason: drizzle-kit cannot emit
-- an opclass index. pg_trgm is already enabled by 0000_initial.sql.
-- Backs `server/api/atlas/places/search.get.ts`'s trigram fallback over
-- ancient place names (e.g. "Bratananium"), the same shape as sites' and
-- cities' own title/name search.
CREATE INDEX IF NOT EXISTS "antiquity_places_title_trgm_idx" ON "antiquity_places" USING gin ("title" gin_trgm_ops);
