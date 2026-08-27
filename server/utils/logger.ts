import { pino, type Logger } from 'pino'

/**
 * The one logger, built once per process — the same lazy-singleton shape as
 * `useRedis()` and `useSql()` beside it.
 *
 * **Production ships no Pino transport at all**, and that is load-bearing
 * rather than a simplification. Pino's transports run in a worker thread, which
 * is exactly what Rollup cannot bundle: Nitro tree-shakes the transport target
 * out of the server bundle and the process then dies at startup looking for a
 * module that was never emitted. Writing plain JSON to stdout has no worker, no
 * bundling problem, and is what the log pipeline wants anyway — Docker's
 * json-file driver collects it and Alloy tails it into Loki.
 *
 * Development is unbundled (`nuxt dev` runs from source), so `pino-pretty` is
 * safe there and the terminal stays readable.
 */

let logger: Logger | undefined

/**
 * Fields scrubbed wherever they appear.
 *
 * Passwords and tokens are obvious. Email is here because the address is the
 * account identifier: an auth log that records every failed attempt would
 * otherwise become a list of who has an account, which is precisely what
 * `forgot-password` refuses to disclose over HTTP.
 */
const REDACTED_FIELDS = [
  'password',
  'passwordHash',
  'password_hash',
  'email',
  'token',
  'secret',
  'authorization',
  'cookie',
  'set-cookie',
  '*.password',
  '*.email',
  '*.token',
  'req.headers.authorization',
  'req.headers.cookie',
]

export const useLogger = (): Logger => {
  if (!logger) {
    const { telemetry } = useRuntimeConfig()

    logger = pino({
      level: telemetry.logLevel || 'info',
      redact: { paths: REDACTED_FIELDS, censor: '[redacted]' },
      base: { service: telemetry.serviceName },
      // Loki and Grafana both read epoch milliseconds; Pino's default is
      // already that, but stating it stops a future default change from
      // quietly shifting every timestamp.
      timestamp: pino.stdTimeFunctions.epochTime,
      formatters: {
        // `level: "warn"` rather than `level: 30`. The number is smaller on the
        // wire and unreadable in a LogQL query written by a human at 2am.
        level: (label) => ({ level: label }),
      },
      ...(import.meta.dev
        ? {
            transport: {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'HH:MM:ss',
                ignore: 'pid,hostname,service',
              },
            },
          }
        : {}),
    })
  }

  return logger
}

/**
 * The logger for one request, carrying its id so every line from that request
 * can be pulled out of Loki together — and so a trace, a log line and a 500 the
 * visitor reports can be joined by a value all three share.
 */
export const createRequestLogger = (requestId: string): Logger => useLogger().child({ requestId })
