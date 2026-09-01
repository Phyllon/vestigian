import {
  date,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sites } from './sites'
import { users } from './users'

/**
 * A reader's own traces — which sites they have stood on, and which they mean
 * to.
 *
 * Everything else in this schema is the shared record: the atlas contributors
 * build together and moderators review. These two tables are not that. They are
 * personal data about one person, with one lawful reader, and three rules
 * follow from that which no other table here has to obey:
 *
 * 1. **They never go through `applyRevision()`.** That path exists for changes
 *    to the shared record. Routing a private bookmark through the revision and
 *    moderation machinery would put a moderator in front of someone's travel
 *    plans. The handlers under `server/api/me/` write these tables directly and
 *    are the only writes in the app that do.
 * 2. **They are never joined into `/api/data/sites.geojson`** or any other
 *    public feed. The `antiquity_*` tables are kept out of that feed for a
 *    licence reason; these are kept out for a data-protection one.
 * 3. **They never enter the MVT pipeline.** Tile invalidation is a single
 *    global counter (`bumpDataVersion()`), which is what lets tiles be cached
 *    far longer than editable content normally allows. A per-user layer inside
 *    `ST_AsMVT` would make every tile per-user and throw that away. The map
 *    draws these as a separate client-side GeoJSON source fed by
 *    `/api/me/map.geojson`.
 *
 * Both cascade from `users`, so `auth/account.delete.ts` erases them with the
 * account and needs no change.
 */
export const siteVisits = pgTable(
  'site_visits',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    siteId: integer('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    /**
     * Nullable on purpose. "I have been, I do not recall when" is a real
     * answer, and a required date would be filled in with an invented one.
     */
    visitedOn: date('visited_on'),
    /**
     * The visitor's own note, private to them. Not a description of the site —
     * that is what a contribution is for, and it goes through review.
     */
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * One row per person per site: revisiting updates rather than appends. This
     * records *whether* someone has stood somewhere, not an itinerary — a log
     * of repeat trips is a movement history worth more to an attacker than to
     * the person who made it.
     */
    uniqueIndex('site_visits_user_site_idx').on(table.userId, table.siteId),
    index('site_visits_user_recent_idx').on(table.userId, table.visitedOn),
    index('site_visits_site_idx').on(table.siteId),
  ],
)

/** The to-visit list. Feeds the GPX field kit at `/api/me/field-kit.gpx`. */
export const siteBookmarks = pgTable(
  'site_bookmarks',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    siteId: integer('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('site_bookmarks_user_site_idx').on(table.userId, table.siteId),
    index('site_bookmarks_user_recent_idx').on(table.userId, table.createdAt),
  ],
)
