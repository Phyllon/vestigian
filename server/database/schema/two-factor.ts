import { index, integer, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core'
import { users } from './users'

/**
 * One row per issued backup code, hashed the same way as `emailTokens` — see
 * `hashToken`/`tokenHashMatches` in `server/utils/tokens.ts`. Ten are issued
 * when 2FA is enabled and shown once; regenerating replaces the whole set.
 * `consumedAt` is what makes each one single-use.
 */
export const twoFactorBackupCodes = pgTable(
  'two_factor_backup_codes',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: varchar('code_hash', { length: 255 }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('two_factor_backup_codes_user').on(table.userId)],
)
