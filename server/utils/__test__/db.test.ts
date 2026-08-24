import { beforeAll, describe, expect, it, vi } from 'vitest'
import type postgres from 'postgres'

/**
 * `drizzle(client)` overwrites the timestamp parsers on the client it is given,
 * because it maps those types itself. If the query builder and the raw PostGIS
 * queries share one client, every `timestamptz` comes back as a string and the
 * failure surfaces far from its cause — `updated_at.toISOString is not a
 * function`, in whichever handler happens to read a date first.
 *
 * No connection is opened here: postgres.js builds its pool lazily, so this
 * asserts on configuration alone.
 */
describe('database clients', () => {
  let useSql: () => postgres.Sql
  let useDatabase: () => unknown

  beforeAll(async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      databaseUrl: 'postgres://vestigia:vestigia@127.0.0.1:5432/vestigia',
    }))
    const module = await import('../db')
    useSql = module.useSql
    useDatabase = module.useDatabase
  })

  it('keeps parsing timestamps into dates after Drizzle has been constructed', () => {
    const sql = useSql() as unknown as {
      options: { parsers: Record<number, (raw: string) => unknown> }
    }
    useDatabase()

    for (const oid of [1082, 1114, 1184]) {
      expect(sql.options.parsers[oid]?.('2026-08-20 14:40:59.213745+00')).toBeInstanceOf(Date)
    }
  })

  it('hands the raw client back as a singleton', () => {
    expect(useSql()).toBe(useSql())
  })
})
