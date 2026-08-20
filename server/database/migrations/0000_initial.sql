-- Vestigia initial schema.
--
-- Written by hand rather than generated, because three things in this schema are
-- outside what drizzle-kit can emit: the PostGIS geometry columns, the GiST
-- indexes those columns need, and the expression indexes backing site search.
-- Regenerating from the schema files would silently drop all three.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ---------------------------------------------------------------- enumerations
CREATE TYPE "user_role" AS ENUM ('contributor', 'moderator', 'admin');
CREATE TYPE "review_status" AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE "geometry_kind" AS ENUM ('point', 'line', 'area');
CREATE TYPE "site_category" AS ENUM (
  'settlement', 'fortification', 'sanctuary', 'burial',
  'infrastructure', 'villa', 'production', 'findspot', 'other'
);

-- ----------------------------------------------------------------------- users
CREATE TABLE "users" (
  "id" serial PRIMARY KEY,
  "email" varchar(320) NOT NULL,
  "display_name" varchar(60) NOT NULL,
  "password_hash" varchar(255) NOT NULL,
  "role" "user_role" DEFAULT 'contributor' NOT NULL,
  "trust_level" smallint DEFAULT 0 NOT NULL,
  "approved_contributions" integer DEFAULT 0 NOT NULL,
  "trust_revoked" boolean DEFAULT false NOT NULL,
  "email_verified_at" timestamptz,
  "last_seen_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "users_email_idx" ON "users" (lower("email"));
CREATE UNIQUE INDEX "users_display_name_idx" ON "users" (lower("display_name"));
CREATE INDEX "users_role_idx" ON "users" ("role");

CREATE TABLE "email_tokens" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "token_hash" varchar(255) NOT NULL,
  "purpose" varchar(20) NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz
);

CREATE INDEX "email_tokens_lookup" ON "email_tokens" ("token_hash");
CREATE INDEX "email_tokens_user" ON "email_tokens" ("user_id");

-- ----------------------------------------------------------------------- sites
CREATE TABLE "sites" (
  "id" serial PRIMARY KEY,
  "slug" varchar(160) NOT NULL,
  "title" varchar(240) NOT NULL,
  "category" "site_category" DEFAULT 'other' NOT NULL,
  "summary" text,
  "description" text,
  "geom" geometry(Point, 4326) NOT NULL,
  "period_from" integer,
  "period_to" integer,
  "country_code" varchar(2),
  "modern_place" varchar(240),
  "status" "review_status" DEFAULT 'pending' NOT NULL,
  "source_ref" varchar(120),
  "licence" varchar(60) DEFAULT 'CC-BY-SA-3.0' NOT NULL,
  "attribution" text,
  "created_by" integer REFERENCES "users" ("id") ON DELETE SET NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  -- A period that ends before it begins is always a data error, not an edge case.
  CONSTRAINT "sites_period_order" CHECK (
    "period_from" IS NULL OR "period_to" IS NULL OR "period_from" <= "period_to"
  )
);

-- The index every tile request depends on.
CREATE INDEX "sites_geom_idx" ON "sites" USING gist ("geom");
CREATE UNIQUE INDEX "sites_slug_idx" ON "sites" ("slug");
CREATE UNIQUE INDEX "sites_source_ref_idx" ON "sites" ("source_ref") WHERE "source_ref" IS NOT NULL;

-- Partial: tile and search queries only ever look at approved rows, so the
-- pending backlog is kept out of the index entirely.
CREATE INDEX "sites_status_idx" ON "sites" ("status");
CREATE INDEX "sites_approved_geom_idx" ON "sites" USING gist ("geom") WHERE "status" = 'approved';
CREATE INDEX "sites_category_idx" ON "sites" ("category");

CREATE INDEX "sites_search_idx" ON "sites"
  USING gin (to_tsvector('simple', "title" || ' ' || coalesce("summary", '')));
CREATE INDEX "sites_title_trgm_idx" ON "sites" USING gin ("title" gin_trgm_ops);

-- -------------------------------------------------------------------- tracings
CREATE TABLE "tracings" (
  "id" serial PRIMARY KEY,
  "title" varchar(240) NOT NULL,
  "kind" "geometry_kind" DEFAULT 'line' NOT NULL,
  "category" "site_category" DEFAULT 'infrastructure' NOT NULL,
  "geom" geometry(Geometry, 4326) NOT NULL,
  "description" text,
  "status" "review_status" DEFAULT 'pending' NOT NULL,
  "source_ref" varchar(120),
  "licence" varchar(60) DEFAULT 'CC-BY-SA-3.0' NOT NULL,
  "attribution" text,
  "created_by" integer REFERENCES "users" ("id") ON DELETE SET NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX "tracings_geom_idx" ON "tracings" USING gist ("geom");
CREATE INDEX "tracings_approved_geom_idx" ON "tracings" USING gist ("geom") WHERE "status" = 'approved';
CREATE INDEX "tracings_status_idx" ON "tracings" ("status");
CREATE UNIQUE INDEX "tracings_source_ref_idx" ON "tracings" ("source_ref") WHERE "source_ref" IS NOT NULL;

-- ---------------------------------------------------------------------- images
CREATE TABLE "site_images" (
  "id" serial PRIMARY KEY,
  "site_id" integer NOT NULL REFERENCES "sites" ("id") ON DELETE CASCADE,
  "storage_key" varchar(300) NOT NULL,
  "caption" text,
  "licence" varchar(60) NOT NULL,
  "attribution" text,
  "source_url" text,
  "width" integer NOT NULL,
  "height" integer NOT NULL,
  "captured_at" timestamptz,
  "status" "review_status" DEFAULT 'pending' NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_by" integer REFERENCES "users" ("id") ON DELETE SET NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX "site_images_site_idx" ON "site_images" ("site_id", "sort_order");
CREATE INDEX "site_images_status_idx" ON "site_images" ("status");

CREATE TABLE "external_ids" (
  "id" serial PRIMARY KEY,
  "site_id" integer NOT NULL REFERENCES "sites" ("id") ON DELETE CASCADE,
  "scheme" varchar(40) NOT NULL,
  "value" varchar(120) NOT NULL
);

CREATE UNIQUE INDEX "external_ids_unique" ON "external_ids" ("site_id", "scheme", "value");
CREATE INDEX "external_ids_lookup" ON "external_ids" ("scheme", "value");

-- ------------------------------------------------------------------- revisions
CREATE TABLE "revisions" (
  "id" serial PRIMARY KEY,
  "entity_type" varchar(20) NOT NULL,
  "entity_id" integer,
  "payload" jsonb NOT NULL,
  "status" "review_status" DEFAULT 'pending' NOT NULL,
  "author_id" integer REFERENCES "users" ("id") ON DELETE SET NULL,
  "reviewer_id" integer REFERENCES "users" ("id") ON DELETE SET NULL,
  "review_note" text,
  "auto_approved" integer DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "reviewed_at" timestamptz
);

-- The moderation queue reads pending rows oldest-first and nothing else, so the
-- index is partial and carries the ordering.
CREATE INDEX "revisions_queue_idx" ON "revisions" ("created_at") WHERE "status" = 'pending';
CREATE INDEX "revisions_entity_idx" ON "revisions" ("entity_type", "entity_id");
CREATE INDEX "revisions_author_idx" ON "revisions" ("author_id");

-- ------------------------------------------------------------ reverse geocoder
CREATE TABLE "geo_names" (
  "id" integer PRIMARY KEY,
  "name" varchar(200) NOT NULL,
  "country_code" varchar(2) NOT NULL,
  "feature_class" varchar(1),
  "population" integer DEFAULT 0 NOT NULL,
  "geom" geometry(Point, 4326) NOT NULL,
  "lat" double precision NOT NULL,
  "lon" double precision NOT NULL
);

CREATE INDEX "geo_names_geom_idx" ON "geo_names" USING gist ("geom");
CREATE INDEX "geo_names_country_idx" ON "geo_names" ("country_code");

-- --------------------------------------------------------------------- touched
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sites_touch" BEFORE UPDATE ON "sites"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER "tracings_touch" BEFORE UPDATE ON "tracings"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
