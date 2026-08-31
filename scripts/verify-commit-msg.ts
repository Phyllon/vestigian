import { readFileSync } from 'node:fs'

/**
 * A light structural check, not a conventional-commits gate.
 *
 * This repository's own history is lowercase, imperative, no type prefix —
 * "add \"follow limes\" feature", "fill antiquity Barrington map", "use
 * Lettermint instead of Resend (mails), send mails where flow demands". A
 * generic feat:/fix: enforcer would fight that style rather than protect it,
 * so this only catches what is unambiguously a mistake: an empty message, or
 * a placeholder ("wip", "fix", "asdf") too short to explain why the change was
 * made — the thing `CLAUDE.md` asks every commit to carry.
 *
 * Skipped for merge commits and fixup!/squash! commits, which are not meant
 * to read as prose.
 */
const MIN_SUBJECT_LENGTH = 10

const messagePath = process.argv[2]
if (!messagePath) {
  console.error('commit-msg hook: no message file path given.')
  process.exit(1)
}

const raw = readFileSync(messagePath, 'utf8')

// Strip comment lines the way git itself does before treating the message as final.
const subject = raw
  .split('\n')
  .find((line) => line.trim().length > 0 && !line.startsWith('#'))
  ?.trim()

if (!subject) {
  console.error('Commit message is empty. Say what changed and why.')
  process.exit(1)
}

if (/^(merge |revert |fixup!|squash!)/i.test(subject)) {
  process.exit(0)
}

if (subject.length < MIN_SUBJECT_LENGTH) {
  console.error(
    `Commit subject "${subject}" is too short (${subject.length} < ${MIN_SUBJECT_LENGTH} characters).\n` +
      'Say what changed, in the style already in this repo\'s log — e.g. "add DARE and AWMC antiquity maps".',
  )
  process.exit(1)
}

process.exit(0)
