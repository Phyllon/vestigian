import { z } from 'zod'

/**
 * The largest value a Postgres `integer` column holds.
 *
 * Every primary key in this schema is `serial`/`integer`, so anything above
 * this cannot identify a row — it can only reach the database and fail there.
 */
const POSTGRES_INTEGER_MAXIMUM = 2_147_483_647

/**
 * An identifier that is safe to put in a query.
 *
 * The upper bound is the part that matters, and it is easy to leave out:
 * `z.coerce.number().int().positive()` accepts `9999999999999999999999`,
 * because JavaScript coerces it to `1e+22` and considers that both an integer
 * and positive. Postgres does not — it rejects the literal, and the handler
 * answers 500 for what is plainly a malformed request. Bounding it here turns
 * that into the 400 it always was.
 */
export const databaseIdentifier = z.number().int().positive().max(POSTGRES_INTEGER_MAXIMUM)

/** The same, for route parameters, which always arrive as strings. */
export const routeIdentifier = z.coerce.number().int().positive().max(POSTGRES_INTEGER_MAXIMUM)
