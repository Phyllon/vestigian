-- Not representable in the drizzle schema: drizzle-kit cannot emit an opclass
-- index or an expression index (see 0011_glorious_exodus.sql, 0017). Additive
-- only — one function, eight indexes, no data touched, nothing for an importer
-- to re-run. pg_trgm and unaccent are enabled by 0000_initial.sql.
--
-- Backs `server/api/search/reference.get.ts`, which makes every borrowed
-- reference layer findable by name from the map search bar (hillforts, ports,
-- monuments, mints, battles, coin hoards, minor features, Tabula places).
--
-- `unaccent()` is only STABLE, and an index expression must be IMMUTABLE, so
-- the dictionary is pinned in a wrapper. That is what lets "Dun Mor" find a
-- stored "Dùn Mòr" (and the reverse) through the index.
CREATE OR REPLACE FUNCTION "vestigian_unaccent"(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "antiquity_hillforts_name_search_idx" ON "antiquity_hillforts" USING gin (vestigian_unaccent("name") gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "antiquity_ports_title_search_idx" ON "antiquity_ports" USING gin (vestigian_unaccent("title") gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "antiquity_monuments_name_search_idx" ON "antiquity_monuments" USING gin (vestigian_unaccent("name") gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "antiquity_mints_name_search_idx" ON "antiquity_mints" USING gin (vestigian_unaccent("name") gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "antiquity_battles_title_search_idx" ON "antiquity_battles" USING gin (vestigian_unaccent("title") gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "antiquity_coin_hoards_name_search_idx" ON "antiquity_coin_hoards" USING gin (vestigian_unaccent("name") gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "antiquity_features_name_search_idx" ON "antiquity_features" USING gin (vestigian_unaccent("name") gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tabula_peutingeriana_places_label_search_idx" ON "tabula_peutingeriana_places" USING gin (vestigian_unaccent("label") gin_trgm_ops);
