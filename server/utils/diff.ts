import type postgres from 'postgres'
export type ChangeKind = 'added' | 'removed' | 'changed'

export interface FieldChange {
  field: string
  kind: ChangeKind
  before: string | null
  after: string | null
}

/** Fields never worth showing in a diff — noise, not content. */
const IGNORED_FIELDS = new Set(['kind', 'entityId'])

const asDisplayValue = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * A revision payload as it round-trips through a `jsonb` column.
 *
 * Drizzle types `jsonb` as `unknown`, which is honest — the database will
 * store whatever it is given. Naming the shape here, next to the code that
 * reads it, means the cast happens once at each boundary instead of being
 * re-invented at every call site. `postgres.JSONValue` rather than `unknown`
 * because `sql.json()` insists on it, so that a symbol or a bigint cannot be
 * handed to Postgres and silently serialised to nothing.
 */
export type StoredPayload = Record<string, postgres.JSONValue | undefined>

/**
 * Compares two revision payloads field by field. A moderator reviewing an edit
 * needs to see what changed, not read two records and find the difference
 * themselves — which is how bad edits slip through a queue.
 */
export const diffPayloads = (before: StoredPayload | null, after: StoredPayload): FieldChange[] => {
  const changes: FieldChange[] = []
  const fields = new Set([...Object.keys(before ?? {}), ...Object.keys(after)])

  for (const field of fields) {
    if (IGNORED_FIELDS.has(field)) continue

    const previous = asDisplayValue(before?.[field])
    const next = asDisplayValue(after[field])

    if (previous === next) continue

    changes.push({
      field,
      kind: previous === null ? 'added' : next === null ? 'removed' : 'changed',
      before: previous,
      after: next,
    })
  }

  return changes.sort((a, b) => a.field.localeCompare(b.field))
}

/**
 * A rough measure of how much an edit touches, used to flag large rewrites in
 * the queue. Deleting a long description and adding a short one should read as
 * a bigger change than correcting a date.
 */
export const measureChangeWeight = (changes: FieldChange[]): number =>
  changes.reduce((weight, change) => {
    const removed = change.before?.length ?? 0
    const added = change.after?.length ?? 0
    return weight + Math.max(removed, added)
  }, 0)

/** Edits above this weight are marked for closer attention in the queue. */
export const SUBSTANTIAL_CHANGE_WEIGHT = 500

export const isSubstantialEdit = (changes: FieldChange[]): boolean =>
  measureChangeWeight(changes) >= SUBSTANTIAL_CHANGE_WEIGHT

/**
 * Detects an edit that empties fields without replacing them — the signature of
 * casual vandalism, and worth surfacing even when the account is trusted.
 */
export const isBlankingEdit = (changes: FieldChange[]): boolean => {
  const removals = changes.filter((change) => change.kind === 'removed')
  if (removals.length === 0) return false
  const additions = changes.filter((change) => change.kind !== 'removed')
  return removals.length > additions.length
}
