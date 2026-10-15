-- Local: stage everything vici-derived, keyed by source_ref (never by id).
DROP SCHEMA IF EXISTS vici_stage CASCADE;
CREATE SCHEMA vici_stage;

CREATE TABLE vici_stage.sites AS
  SELECT slug, title, category, subcategory, summary, description, geom,
         period_from, period_to, country_code, status, source_ref, licence, attribution
  FROM public.sites WHERE source_ref LIKE 'vici.org#%';

CREATE TABLE vici_stage.tracings AS
  SELECT title, kind, category, geom, description, status, source_ref, licence, attribution
  FROM public.tracings WHERE source_ref LIKE 'vici.org-line#%';

CREATE TABLE vici_stage.external_ids AS
  SELECT s.source_ref, e.scheme, e.value
  FROM public.external_ids e JOIN public.sites s ON s.id = e.site_id
  WHERE s.source_ref LIKE 'vici.org#%';

CREATE TABLE vici_stage.site_images AS
  SELECT s.source_ref, i.storage_key, i.caption, i.licence, i.attribution, i.source_url,
         i.width, i.height, i.captured_at, i.status, i.sort_order
  FROM public.site_images i JOIN public.sites s ON s.id = i.site_id
  WHERE s.source_ref LIKE 'vici.org#%' AND i.created_by IS NULL;
