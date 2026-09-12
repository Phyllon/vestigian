import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  boolean,
  index,
  integer,
  jsonb,
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
    /**
     * A block on the person, not on their work. Null means active.
     *
     * Deliberately a timestamp rather than a boolean: the audit log records
     * the decision, but the account row should be able to answer "since when"
     * on its own, without a join to a table that only exists for review.
     * Distinct from `trustRevoked` in kind, not just in degree — a revoked
     * account still works and simply has its edits queued, a banned one
     * cannot sign in, cannot write, and has every live session killed. What
     * it does *not* touch is anything they already published; taking that
     * offline is a separate, deliberate sweep (`server/utils/retraction.ts`).
     */
    bannedAt: timestamp('banned_at', { withTimezone: true }),
    /** Sent to the person. Same length as a trust-revocation reason. */
    banReason: varchar('ban_reason', { length: 300 }),
    bannedBy: integer('banned_by').references((): AnyPgColumn => users.id, {
      onDelete: 'set null',
    }),
    /**
     * The session epoch — **the only session revocation this app has.**
     *
     * Sessions are stateless: `auth/login.post.ts` seals `loggedInAt` into an
     * iron cookie and nothing refreshes or stores it, so there is no session
     * table to delete a row from. Comparing that sealed `loggedInAt` against
     * this column (`isSessionCurrent`) makes every cookie issued before the
     * timestamp dead on its very next request, with no new storage anywhere.
     * Bumping it is what makes a ban bite immediately rather than whenever
     * the person next happens to sign out, and it is the whole of
     * "sign out everywhere".
     */
    sessionsValidFrom: timestamp('sessions_valid_from', { withTimezone: true })
      .notNull()
      .defaultNow(),
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

/**
 * Who did what in `/admin`, append-only.
 *
 * Nothing in the app ever updates or deletes a row here — the same discipline
 * `revisions` keeps, for the same reason. It duplicates the `audit:` lines
 * that already go to the request log on purpose: those live in Loki on a
 * 30-day retention and need Grafana open to read, while this is the durable,
 * in-app record an administrator can actually be held to, and the thing that
 * makes an admin-visible email address defensible rather than merely
 * convenient.
 *
 * It deliberately holds **no IP addresses and no credentials**. Addresses are
 * in the request log on a documented retention and a lawful basis of their
 * own (`.claude/rules/gdpr-legal.md`); this panel is not a log viewer, and a
 * second, unbounded store of them would be a new liability rather than a new
 * capability.
 */
export const adminAuditLog = pgTable(
  'admin_audit_log',
  {
    id: serial('id').primaryKey(),
    /**
     * Set null rather than cascade: an administrator exercising their own
     * right to erasure must not take the record of their decisions with them.
     */
    actorId: integer('actor_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
    /** One of `AdminAction` (`shared/utils/authorization.ts`). */
    action: varchar('action', { length: 40 }).notNull(),
    /** 'account' | 'revision' | 'image' | 'system' — what was acted on. */
    subjectType: varchar('subject_type', { length: 20 }).notNull(),
    subjectId: integer('subject_id'),
    /** What was decided: a reason, a role transition, a retraction count. */
    detail: jsonb('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('admin_audit_created_idx').on(table.createdAt),
    index('admin_audit_subject_idx').on(table.subjectType, table.subjectId),
    index('admin_audit_actor_idx').on(table.actorId),
  ],
)
