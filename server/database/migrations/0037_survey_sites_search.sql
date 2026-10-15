-- Not representable in the drizzle schema (drizzle-kit cannot emit an expression index; see
-- 0032_reference_search.sql, which also defines vestigian_unaccent). Additive: one index, no data
-- touched. Backs the `survey-site` branch of `server/api/search/reference.get.ts`, which makes the
-- dated survey sites (`antiquity_survey_sites`) findable by name from the map search bar.
CREATE INDEX IF NOT EXISTS "antiquity_survey_sites_name_search_idx" ON "antiquity_survey_sites" USING gin (vestigian_unaccent("name") gin_trgm_ops);
