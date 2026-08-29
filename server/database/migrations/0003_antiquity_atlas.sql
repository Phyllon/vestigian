-- The antiquity atlas: reference cartography, not contributed records.
--
-- These tables hold third-party open data — the Ancient World Mapping Center's
-- Barrington-derived geodata (ODbL 1.0) and Pleiades places (CC BY 3.0) — that
-- the 'antiquity-awmc' basemap is drawn from. They are deliberately separate
-- from `sites` and `tracings` and are never joined to them.
--
-- That separation is a licence decision, not tidiness. ODbL's share-alike
-- attaches to a *derivative database*: folding AWMC features into the tables
-- behind /api/data/sites.geojson would make that feed arguably a derivative and
-- pull the whole thing under ODbL, which contradicts the CC BY-SA / CC0 the
-- contributed data is offered under. Rendered tiles are a Produced Work and
-- need only attribution, so keeping the two apart is what makes this usable.
--
-- Everything here is rebuildable from `pnpm import:atlas` and holds nothing a
-- contributor typed, so it does not need to survive a restore.

CREATE TYPE antiquity_line_kind AS ENUM ('road', 'aqueduct', 'canal', 'wall', 'shoreline');
CREATE TYPE antiquity_water_kind AS ENUM ('sea', 'inland');

CREATE TABLE antiquity_water (
  id serial PRIMARY KEY,
  kind antiquity_water_kind NOT NULL,
  name varchar(240),
  geom geometry(MultiPolygon, 4326) NOT NULL
);

CREATE TABLE antiquity_lines (
  id serial PRIMARY KEY,
  kind antiquity_line_kind NOT NULL,
  name varchar(240),
  -- Barrington's own distinctions: a major route rather than a track, and a
  -- course established rather than inferred. Both change how the line is drawn,
  -- so a reader can tell a certainty claim from a guess.
  major boolean NOT NULL DEFAULT false,
  certain boolean NOT NULL DEFAULT true,
  period varchar(16),
  geom geometry(MultiLineString, 4326) NOT NULL
);

CREATE TABLE antiquity_areas (
  id serial PRIMARY KEY,
  kind varchar(32) NOT NULL,
  name varchar(240),
  pleiades_id varchar(32),
  geom geometry(MultiPolygon, 4326) NOT NULL
);

-- Regions and peoples. AWMC publishes these as linework — the extent is drawn,
-- not filled — so the label point is derived once at import rather than being
-- recomputed per tile.
CREATE TABLE antiquity_regions (
  id serial PRIMARY KEY,
  title varchar(240) NOT NULL,
  kind varchar(64),
  pleiades_id varchar(32),
  min_year integer,
  max_year integer,
  geom geometry(MultiLineString, 4326) NOT NULL,
  label_geom geometry(Point, 4326) NOT NULL
);

CREATE TABLE antiquity_places (
  id serial PRIMARY KEY,
  pleiades_id varchar(32) NOT NULL,
  title varchar(300) NOT NULL,
  description text,
  feature_types varchar(240),
  min_year integer,
  max_year integer,
  location_precision varchar(24),
  geom geometry(Point, 4326) NOT NULL
);

CREATE UNIQUE INDEX antiquity_places_pleiades_idx ON antiquity_places (pleiades_id);

-- One GiST index per table; every tile query is a bbox intersection and nothing
-- else. `kind` is indexed only where a layer is filtered by it at read time.
CREATE INDEX antiquity_water_geom_idx ON antiquity_water USING gist (geom);
CREATE INDEX antiquity_lines_geom_idx ON antiquity_lines USING gist (geom);
CREATE INDEX antiquity_lines_kind_idx ON antiquity_lines (kind);
CREATE INDEX antiquity_areas_geom_idx ON antiquity_areas USING gist (geom);
CREATE INDEX antiquity_regions_label_idx ON antiquity_regions USING gist (label_geom);
CREATE INDEX antiquity_regions_geom_idx ON antiquity_regions USING gist (geom);
CREATE INDEX antiquity_places_geom_idx ON antiquity_places USING gist (geom);
