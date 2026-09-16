import { hash } from '@node-rs/argon2'
import postgres from 'postgres'
import { requireDatabaseUrl } from '../../server/database/database-url'

/**
 * The accounts every e2e test signs in as.
 *
 * Seeded once by `global-setup` and reused, because argon2id at OWASP
 * parameters costs about 50 ms per hash by design — doing it per test would
 * make the suite slower than the application it tests.
 *
 * Addresses end in `@e2e.local` so the teardown can remove exactly what it
 * created and nothing else. They are deliberately far away from the shape of a
 * real address, so a stray fixture cannot collide with a genuine contributor.
 */
export const E2E_PASSWORD = 'E2E-Testing-Pass-1!'

export interface TestAccount {
  email: string
  displayName: string
  role: 'contributor' | 'moderator' | 'admin'
  /** Zero keeps every contribution queued; two or more publishes immediately. */
  approvedContributions: number
  /** Defaults to confirmed. Only the account testing the resend is not. */
  emailVerified?: boolean
}

export const ACCOUNTS = {
  /** Trust level 0 — everything this account submits goes to the queue. */
  newcomer: {
    email: 'newcomer@e2e.local',
    displayName: 'E2E Newcomer',
    role: 'contributor',
    approvedContributions: 0,
  },
  /** Past the threshold — publishes immediately. */
  trusted: {
    email: 'trusted@e2e.local',
    displayName: 'E2E Trusted',
    role: 'contributor',
    approvedContributions: 5,
  },
  /**
   * Never confirmed its address, so `login` refuses it and re-sends the link.
   * Nothing else may sign in as this account.
   */
  unverified: {
    email: 'unverified@e2e.local',
    displayName: 'E2E Unverified',
    role: 'contributor',
    approvedContributions: 0,
    emailVerified: false,
  },
  moderator: {
    email: 'moderator@e2e.local',
    displayName: 'E2E Moderator',
    role: 'moderator',
    approvedContributions: 0,
  },
  admin: {
    email: 'admin@e2e.local',
    displayName: 'E2E Admin',
    role: 'admin',
    approvedContributions: 0,
  },
  /**
   * A second administrator, so `admin.spec.ts` can assert that blocking one
   * administrator from another is refused — the rule `checkBan` exists for, and
   * one that cannot be tested with a single admin fixture.
   */
  secondAdmin: {
    email: 'second-admin@e2e.local',
    displayName: 'E2E Second Admin',
    role: 'admin',
    approvedContributions: 0,
  },
  /**
   * Exclusively for `admin.spec.ts` to block and unblock. A shared account
   * would be left unable to sign in for every spec that runs afterwards, and
   * the failure would surface in whichever file happened to come next rather
   * than in the one that caused it.
   */
  blockSubject: {
    email: 'block-subject@e2e.local',
    displayName: 'E2E Block Subject',
    role: 'contributor',
    approvedContributions: 5,
  },
  /**
   * Exclusively for `two-factor.spec.ts` — enabling and disabling a real
   * TOTP secret on `trusted` or another shared account would leave it
   * mid-enrollment for every other spec file that signs in as that account
   * afterward, since `signIn` posts credentials and expects an immediate
   * session rather than a `requiresTwoFactor` challenge.
   */
  twoFactorSubject: {
    email: 'two-factor@e2e.local',
    displayName: 'E2E Two Factor',
    role: 'contributor',
    approvedContributions: 0,
  },
} as const satisfies Record<string, TestAccount>

export type AccountName = keyof typeof ACCOUNTS

const connect = () => postgres(requireDatabaseUrl(), { max: 1 })

/**
 * Idempotent: deletes any leftovers first, so a suite interrupted halfway
 * through leaves nothing that changes the next run's outcome. `email_verified_at`
 * is set because `login.post.ts` refuses unverified addresses outside
 * development, and this suite runs against a production build — except for the
 * one account whose whole purpose is to be refused.
 */
export const seedAccounts = async (): Promise<void> => {
  const sql = connect()

  try {
    const passwordHash = await hash(E2E_PASSWORD, {
      memoryCost: 19456,
      timeCost: 2,
      outputLen: 32,
      parallelism: 1,
    })

    await removeAccounts(sql)

    for (const account of Object.values(ACCOUNTS)) {
      await sql`
        INSERT INTO users (email, display_name, password_hash, role,
                           approved_contributions, email_verified_at)
        VALUES (${account.email}, ${account.displayName}, ${passwordHash},
                ${account.role}::user_role, ${account.approvedContributions},
                ${(account as TestAccount).emailVerified === false ? null : new Date()})
      `
    }
  } finally {
    await sql.end()
  }
}

/**
 * Removes the fixtures and everything they produced. Revisions are deleted
 * before the users they point at, because `revisions.author_id` is
 * `ON DELETE SET NULL` — leaving them would orphan rows into the moderation
 * queue that no later run can explain.
 */
const removeAccounts = async (sql: postgres.Sql): Promise<void> => {
  await sql`
    DELETE FROM revisions
    WHERE author_id IN (SELECT id FROM users WHERE email LIKE '%@e2e.local')
       OR reviewer_id IN (SELECT id FROM users WHERE email LIKE '%@e2e.local')
  `
  await sql`
    DELETE FROM site_images
    WHERE created_by IN (SELECT id FROM users WHERE email LIKE '%@e2e.local')
  `
  // Records the suite published outright — a trusted contributor's edits go
  // live immediately, so they are real rows, not queue entries.
  await sql`DELETE FROM sites WHERE title LIKE 'E2E %'`
  await sql`DELETE FROM email_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@e2e.local')`
  /**
   * Append-only in the application, deliberately — but a suite that blocks and
   * unblocks an account writes rows here on every run, and `actor_id` is
   * `ON DELETE SET NULL`, so leaving them would build an unexplainable trail
   * attributed to nobody. The no-edit rule is about the running application,
   * not about a test fixture cleaning up after itself.
   */
  await sql`
    DELETE FROM admin_audit_log
    WHERE actor_id IN (SELECT id FROM users WHERE email LIKE '%@e2e.local')
       OR (subject_type = 'account'
           AND subject_id IN (SELECT id FROM users WHERE email LIKE '%@e2e.local'))
  `
  await sql`DELETE FROM users WHERE email LIKE '%@e2e.local'`
}

export const clearAccounts = async (): Promise<void> => {
  const sql = connect()
  try {
    await removeAccounts(sql)
  } finally {
    await sql.end()
  }
}
