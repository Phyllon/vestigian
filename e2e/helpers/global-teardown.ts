import { clearAccounts } from './accounts'

/**
 * Removes the fixtures and everything they wrote.
 *
 * `global-setup` also clears them before seeding, so a crashed run cannot
 * poison the next one — this is the tidy path, not the safety net. It matters
 * because the suite submits real contributions: without it the moderation queue
 * fills with test revisions that a human would later have to read and dismiss.
 */
export default async (): Promise<void> => {
  await clearAccounts()
}
