-- A mark for every place the atlas can classify.
--
-- Pleiades describes a place with a comma-separated list from a vocabulary of
-- several hundred terms. Collapsing that into the nine categories the
-- contributed records already use lets one key explain the whole map, and it
-- has to happen once at import rather than per tile: the alternative is a
-- string match against free text inside every symbol layer's filter.
--
-- Nullable on purpose. Rivers, capes, mountains, peoples and regions belong on
-- the sheet as names and are not places with a mark, so `NULL` means "label
-- this, draw no symbol" rather than "unclassified".
ALTER TABLE antiquity_places ADD COLUMN category site_category;

CREATE INDEX antiquity_places_category_idx ON antiquity_places (category);
