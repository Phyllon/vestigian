import { and, eq, isNull } from 'drizzle-orm'
import { twoFactorBackupCodes } from '~~/server/database/schema'

/**
 * Checks a code against either the account's live TOTP secret or its unused
 * backup codes — the one check both `verify-2fa.post.ts` (login) and
 * `2fa/disable.post.ts` need, kept in one place so "what counts as proof"
 * cannot drift between the two call sites.
 *
 * A matched backup code is consumed here, inside the same function that
 * verifies it — there is no path that checks a code without also spending it
 * on success, which is what makes each one truly single-use.
 */
export const verifyTwoFactorCode = async (
  userId: number,
  encryptedSecret: string,
  code: string,
): Promise<boolean> => {
  if (looksLikeBackupCode(code)) {
    return consumeBackupCode(userId, code)
  }

  return verifyTotpCode(decryptTotpSecret(encryptedSecret), code)
}

const consumeBackupCode = async (userId: number, code: string): Promise<boolean> => {
  const database = useDatabase()
  const codeHash = hashToken(code)

  const [matched] = await database
    .select({ id: twoFactorBackupCodes.id })
    .from(twoFactorBackupCodes)
    .where(
      and(
        eq(twoFactorBackupCodes.userId, userId),
        eq(twoFactorBackupCodes.codeHash, codeHash),
        isNull(twoFactorBackupCodes.consumedAt),
      ),
    )
    .limit(1)

  if (!matched) return false

  // A conditional update, not a second read-then-write: two concurrent
  // requests presenting the same still-valid code would otherwise both pass
  // the check above and both report success, spending one code twice.
  const consumed = await database
    .update(twoFactorBackupCodes)
    .set({ consumedAt: new Date() })
    .where(and(eq(twoFactorBackupCodes.id, matched.id), isNull(twoFactorBackupCodes.consumedAt)))
    .returning({ id: twoFactorBackupCodes.id })

  return consumed.length > 0
}
