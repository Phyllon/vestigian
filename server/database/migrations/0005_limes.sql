-- The frontier: named sectors of the limes, and the stretches that make them up.
--
-- These tables sit with `antiquity_*` rather than with `sites`, and for the same
-- reason. Every metre of geometry here is derived from AWMC's extent of the
-- empire and AWMC's wall linework, which are ODbL 1.0, so the share-alike that
-- attaches to a derivative *database* attaches to these rows. Nothing joins them
-- to `sites`, and nothing derived from them is written back onto a contributed
-- record. See the comment at the top of `0003_antiquity_atlas.sql`.
--
-- What a stretch physically was is worth recording, because a map that draws a
-- river the same way it draws a wall is asserting something false about most of
-- the frontier's length.
CREATE TYPE limes_segment_kind AS ENUM ('barrier', 'river', 'notional');

CREATE TABLE limes_sectors (
  id serial PRIMARY KEY,
  slug varchar(80) NOT NULL,
  name varchar(160) NOT NULL,
  latin_name varchar(160),
  summary text,
  pleiades_id varchar(32),
  min_year integer,
  max_year integer,
  length_metres integer NOT NULL,
  geom geometry(MultiLineString, 4326) NOT NULL,
  -- The sector's longest continuous run, kept separately so
  -- `ST_LineLocatePoint` has a single line to measure against. Ordering the
  -- roll of installations along a sector is the whole reason this column
  -- exists: a MultiLineString has no meaningful "distance along".
  path_geom geometry(LineString, 4326) NOT NULL,
  -- Derived once at import so the camera can fit a sector without reading its
  -- geometry, exactly as `antiquity_regions.label_geom` is derived.
  bbox geometry(Polygon, 4326) NOT NULL
);

CREATE TABLE limes_segments (
  id serial PRIMARY KEY,
  sector_id integer NOT NULL REFERENCES limes_sectors (id) ON DELETE CASCADE,
  kind limes_segment_kind NOT NULL,
  -- Carried from AWMC's own `known` flag on wall linework, and true for
  -- stretches derived from the province boundary. Drawn dashed when false, so
  -- the sheet does not assert a course the source records as inferred.
  certain boolean NOT NULL DEFAULT true,
  geom geometry(MultiLineString, 4326) NOT NULL
);

CREATE UNIQUE INDEX limes_sectors_slug_idx ON limes_sectors (slug);
CREATE INDEX limes_sectors_bbox_idx ON limes_sectors USING gist (bbox);
CREATE INDEX limes_sectors_path_idx ON limes_sectors USING gist (path_geom);
CREATE INDEX limes_segments_geom_idx ON limes_segments USING gist (geom);
CREATE INDEX limes_segments_sector_idx ON limes_segments (sector_id);

-- Vici's own kind, recovered.
--
-- `CATEGORY_BY_KIND` in `02-mysql-to-postgres.ts` maps `fort`, `watchtower` and
-- `camp` all onto the single `fortification` category and stored nothing else,
-- so 12,804 records that a reader following a frontier most needs to tell apart
-- were one undifferentiated mark. The enum stays closed — nine categories is
-- the right number for a legend — and the source's own word goes here beside it.
--
-- Free text rather than an enum because it holds a foreign vocabulary this
-- project does not control: vici may add a kind tomorrow, and that must not be
-- a migration. Partial index because only vici-sourced rows carry one.
ALTER TABLE sites ADD COLUMN subcategory varchar(40);

CREATE INDEX sites_subcategory_idx ON sites (subcategory) WHERE subcategory IS NOT NULL;
