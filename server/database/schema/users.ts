import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
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
    approvedContributions: integer('approved_contributions').notNull().default(0),
    /** Set by a moderator to pin a user at level 0 regardless of their count. */
    trustRevoked: boolean('trust_revoked').notNull().default(false),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    /** Shown on the opt-in public contributor page and nowhere else. */
    bio: varchar('bio', { length: 280 }),
    /**
     * A camera hash (`{zoom}/{lat}/{lon}`) — the same string the URL fragment
     * carries, read by the same codec in `useMapInstance`. Three columns would
     * be a second serialisation of a format that already exists.
     */
    homeGround: varchar('home_ground', { length: 64 }),
    /**
     * Off by default. A contributor page appearing unasked would publish an
     * association between a display name and a body of work nobody agreed to.
     */
    publicProfile: boolean('public_profile').notNull().default(false),
    /** Honoured in `server/utils/notifications.ts` before any mail is built. */
    notifyByEmail: boolean('notify_by_email').notNull().default(true),
    preferredLocale: varchar('preferred_locale', { length: 5 }),
    /**
     * AES-256-GCM ciphertext of the TOTP secret (`server/utils/totp.ts`), not
     * a hash — unlike `passwordHash` this has to be reversible to check a
     * live code, so it needs `NUXT_TOTP_ENCRYPTION_KEY` rather than argon2id.
     * Null until enrollment is confirmed; a scanned-but-unconfirmed secret is
     * held in Valkey instead (see `server/api/auth/2fa/setup.post.ts`), never
     * written here.
     */
    totpSecretEncrypted: varchar('totp_secret_encrypted', { length: 255 }),
    totpEnabledAt: timestamp('totp_enabled_at', { withTimezone: true }),
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
    /**
     * The address a `change-email` token is asking to move to, held here until
     * its owner confirms it. Writing it straight to `users` and clearing
     * `email_verified_at` would let a typo — or someone else's address typed
     * into a borrowed session — lock the real owner out of an account they can
     * still see but no longer sign in to. Null for every other purpose.
     */
    newEmail: varchar('new_email', { length: 320 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (table) => [
    index('email_tokens_lookup').on(table.tokenHash),
    index('email_tokens_user').on(table.userId),
  ],
)
