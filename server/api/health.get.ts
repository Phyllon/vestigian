/**
 * Liveness. Answers as long as the process is running.
 *
 * The only unrated endpoint in the app, deliberately: this is what the
 * container's own HEALTHCHECK polls every 30 seconds, and a 429 here would have
 * Docker restart a perfectly healthy container. It touches nothing and does no
 * work, so there is nothing to amplify — `ready`, which does two Postgres round
 * trips and a Redis ping, is rate limited precisely because it is not this.
 */
defineRouteMeta({
  openAPI: {
    tags: ['system'],
    summary: 'Liveness probe',
    description:
      'Answers as long as the process is running. Unrated on purpose — this is what the container HEALTHCHECK polls.',
  },
})

export default defineEventHandler(() => ({ status: 'ok', uptime: process.uptime() }))
