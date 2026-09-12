<script setup lang="ts">
  import type { AdminSystemResponse } from '#shared/types'

  /**
   * What is wrong right now, without bringing Grafana up.
   *
   * Not a replacement for the observability stack and deliberately not a log
   * viewer. It answers the questions an administrator already has while
   * looking at the panel — are the backing services up, is anything queued,
   * did mail stop working — and the last of those is the reason it exists at
   * all: mail delivery **never throws** by design, so a provider outage turns
   * into a counter increment and nothing else. An atlas whose signup
   * confirmations have quietly stopped arriving is exactly the failure that
   * otherwise goes unnoticed.
   */
  const props = defineProps<{ system: AdminSystemResponse | null }>()

  const { t } = useI18n()

  const formatUptime = (seconds: number): string => {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)

    if (days > 0) return t('admin.system.uptimeDays', { days, hours })
    if (hours > 0) return t('admin.system.uptimeHours', { hours, minutes })
    return t('admin.system.uptimeMinutes', { minutes })
  }

  const describeLabels = (labels: Record<string, unknown>): string =>
    Object.values(labels).map(String).join(' / ')

  /**
   * A failed delivery is the one series here that is a problem rather than a
   * measurement, so it is the only one that gets the accent — the design
   * brief's once-per-screen rule applied to a screen made almost entirely of
   * numbers.
   */
  const isFailure = (labels: Record<string, unknown>): boolean =>
    Object.values(labels).some(
      (value) => value === 'failed' || value === 'rejected' || value === 'blocked',
    )
</script>

<template>
  <div class="space-y-4">
    <p v-if="!props.system" class="datum">{{ t('admin.system.loading') }}</p>

    <template v-else>
      <div class="leaf px-3 py-3 sm:px-4">
        <h3 class="text-base text-ink-900 dark:text-paper-100">
          {{ t('admin.system.servicesTitle') }}
        </h3>

        <ul class="mt-2 flex flex-wrap gap-x-6 gap-y-1">
          <li
            v-for="entry in [
              { key: 'database', ok: props.system.checks.database },
              { key: 'cache', ok: props.system.checks.cache },
            ]"
            :key="entry.key"
            class="flex items-center gap-1 text-sm"
            :class="
              entry.ok ? 'text-ink-700 dark:text-paper-200' : 'text-oxide-600 dark:text-oxide-300'
            "
          >
            <UIcon
              :name="entry.ok ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
              class="size-3.5"
              aria-hidden="true"
            />
            {{ t(`admin.system.services.${entry.key}`) }}
          </li>
        </ul>

        <p class="datum mt-2">
          {{ t('admin.system.uptime', { uptime: formatUptime(props.system.uptimeSeconds) }) }}
          <template v-if="props.system.dataVersion !== null">
            · {{ t('admin.system.dataVersion', { version: props.system.dataVersion }) }}
          </template>
        </p>
      </div>

      <div class="leaf px-3 py-3 sm:px-4">
        <h3 class="text-base text-ink-900 dark:text-paper-100">
          {{ t('admin.system.atlasTitle') }}
        </h3>

        <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 xl:grid-cols-4">
          <div
            v-for="entry in [
              { key: 'publishedSites', value: props.system.attention.publishedSites },
              { key: 'publishedTracings', value: props.system.attention.publishedTracings },
              { key: 'accounts', value: props.system.attention.accounts },
              { key: 'accountsLastDay', value: props.system.attention.accountsLastDay },
              { key: 'unverifiedAccounts', value: props.system.attention.unverifiedAccounts },
              { key: 'blockedAccounts', value: props.system.attention.blockedAccounts },
              { key: 'revokedTrust', value: props.system.attention.revokedTrust },
              { key: 'pendingRevisions', value: props.system.attention.pendingRevisions },
            ]"
            :key="entry.key"
          >
            <dt class="eyebrow text-ink-500 dark:text-paper-400">
              {{ t(`admin.system.counts.${entry.key}`) }}
            </dt>
            <dd class="datum text-ink-900 dark:text-paper-100">{{ entry.value }}</dd>
          </div>
        </dl>

        <p class="datum mt-2">{{ t('admin.system.signalsNote') }}</p>
      </div>

      <div
        v-for="counter in props.system.counters"
        :key="counter.name"
        class="leaf px-3 py-3 sm:px-4"
      >
        <h3 class="text-base text-ink-900 dark:text-paper-100">
          {{ t(`admin.system.counters.${counter.name}`) }}
        </h3>
        <p class="datum mt-0.5">{{ counter.help }}</p>

        <ul v-if="counter.series?.length" class="mt-2 space-y-1">
          <li
            v-for="(series, index) in counter.series"
            :key="index"
            class="flex items-baseline gap-2 text-sm"
            :class="isFailure(series.labels) ? 'text-oxide-600 dark:text-oxide-300' : undefined"
          >
            <span class="datum">{{ describeLabels(series.labels) }}</span>
            <span class="ml-auto tabular-nums">{{ series.value }}</span>
          </li>
        </ul>
        <p v-else class="datum mt-2">{{ t('admin.system.noSeries') }}</p>
      </div>

      <!--
        Said plainly rather than left to be discovered: these are
        process-lifetime totals, so a low number after a deploy is a restart
        rather than good news.
      -->
      <p class="datum">{{ t('admin.system.countersNote') }}</p>
    </template>
  </div>
</template>
