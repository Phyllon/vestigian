CREATE TABLE IF NOT EXISTS "edh_findspots" (
	"id" serial PRIMARY KEY NOT NULL,
	"edh_uri" varchar(200) NOT NULL,
	"ancient_findspot" varchar(200),
	"pleiades_id" varchar(32),
	"trismegistos_id" varchar(32),
	"geom" geometry(Point, 4326) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "edh_findspots_geom_idx" ON "edh_findspots" USING gist ("geom");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "edh_findspots_pleiades_idx" ON "edh_findspots" USING btree ("pleiades_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "edh_findspots_trismegistos_idx" ON "edh_findspots" USING btree ("trismegistos_id");