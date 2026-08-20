/** Liveness. Answers as long as the process is running. */
export default defineEventHandler(() => ({ status: 'ok', uptime: process.uptime() }))
