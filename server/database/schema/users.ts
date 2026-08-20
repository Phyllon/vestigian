import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  smallint,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'

export const userRoleEnum = pgEnum('user_role', ['contributor', 'moderator', 'admin'])

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    email: varchar('email', { length: 320 }).notNull(),
    displayName: varchar('display_name', { length: 60 }).notNull(),
    /** argon2id. Never logged, never returned by any endpoint. */
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    role: userRoleEnum('role').notNull().default('contributor'),
    /** 0 = every contribution queued, 1 = auto-approved. */
    trustLevel: smallint('trust_level').notNull().default(0),
    approvedContributions: integer('approved_contributions').notNull().default(0),
    /** Set by a moderator to pin a user at level 0 regardless of their count. */
    trustRevoked: boolean('trust_revoked').notNull().default(false),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_email_idx').on(table.email),
    uniqueIndex('users_display_name_idx').on(table.displayName),
    index('users_role_idx').on(table.role),
  ],
)

export const emailTokens = pgTable(
  'email_tokens',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Only a hash of the token is stored, so a database leak grants nothing. */
    tokenHash: varchar('token_hash', { length: 255 }).notNull(),
    purpose: varchar('purpose', { length: 20 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (table) => [
    index('email_tokens_lookup').on(table.tokenHash),
    index('email_tokens_user').on(table.userId),
  ],
)
