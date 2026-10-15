-- VPS: additive merge. Existing rows are never touched; one transaction.
BEGIN;

INSERT INTO sites (slug, title, category, subcategory, summary, description, geom,
                   period_from, period_to, country_code, status, source_ref, licence, attribution)
SELECT CASE WHEN EXISTS (SELECT 1 FROM sites e WHERE e.slug = n.slug)
            THEN left(n.slug, 140) || '-' || substring(n.source_ref FROM 10)
            ELSE n.slug END,
       n.title, n.category, n.subcategory, n.summary, n.description, n.geom,
       n.period_from, n.period_to, n.country_code, n.status, n.source_ref, n.licence, n.attribution
FROM vici_stage.sites n
WHERE NOT EXISTS (SELECT 1 FROM sites s WHERE s.source_ref = n.source_ref);

INSERT INTO tracings (title, kind, category, geom, description, status, source_ref, licence, attribution)
SELECT n.title, n.kind, n.category, n.geom, n.description, n.status, n.source_ref, n.licence, n.attribution
FROM vici_stage.tracings n
WHERE NOT EXISTS (SELECT 1 FROM tracings t WHERE t.source_ref = n.source_ref);

INSERT INTO external_ids (site_id, scheme, value)
SELECT s.id, n.scheme, n.value
FROM vici_stage.external_ids n JOIN sites s ON s.source_ref = n.source_ref
WHERE NOT EXISTS (SELECT 1 FROM external_ids x
                  WHERE x.site_id = s.id AND x.scheme = n.scheme AND x.value = n.value);

INSERT INTO site_images (site_id, storage_key, caption, licence, attribution, source_url,
                         width, height, captured_at, status, sort_order)
SELECT s.id, n.storage_key, n.caption, n.licence, n.attribution, n.source_url,
       n.width, n.height, n.captured_at, n.status, n.sort_order
FROM vici_stage.site_images n JOIN sites s ON s.source_ref = n.source_ref
WHERE NOT EXISTS (SELECT 1 FROM site_images x WHERE x.site_id = s.id AND x.storage_key = n.storage_key);

SELECT 'sites' AS t, count(*) FROM sites UNION ALL
SELECT 'tracings', count(*) FROM tracings UNION ALL
SELECT 'site_images', count(*) FROM site_images UNION ALL
SELECT 'external_ids', count(*) FROM external_ids;

COMMIT;
