import { index, integer, pgTable, serial, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { sites } from './sites'
import { users } from './users'

/**
 * "I found this useful" — a general, positive-only signal open to any
 * signed-in reader, not gated on having recorded a visit through
 * `site_visits`.
 *
 * Deliberately **not** in `notebook.ts` beside `siteVisits`/`siteBookmarks`,
 * despite the identical one-row-per-person-per-site shape: those two are
 * strictly private by rule, and this table's whole purpose is a public
 * **count**. Filing it alongside them would read as though it followed the
 * same "never reaches a public feed" rule when it explicitly does not — see
 * `loadSiteDetail` in `server/utils/site-record.ts`, which aggregates it into
 * every public site response. What stays private is the row itself: nobody
 * but the endorser ever sees *who* endorsed a site or *when*, the same
 * exposure `site_bookmarks` gets. An endorsement carries no coordinate and
 * no timestamp anyone else can read, which is what makes the count safe to
 * publish where a visit count would not be.
 *
 * Survives account erasure. `auth/account.delete.ts` anonymises rather than
 * deletes, so `ON DELETE CASCADE` here never fires on that path — and
 * deliberately is not given a matching explicit delete the way
 * `site_visits`/`site_bookmarks` are, because there is nothing left to erase
 * for privacy's sake: the row carries no attribution any public surface
 * exposes, so removing it would only make the public count wrong.
 */
export const siteEndorsements = pgTable(
  'site_endorsements',
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
    uniqueIndex('site_endorsements_user_site_idx').on(table.userId, table.siteId),
    index('site_endorsements_site_idx').on(table.siteId),
  ],
)
