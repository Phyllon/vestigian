<script setup lang="ts">
  /**
   * The marks, as stamps pressed into the page.
   *
   * Flat, ruled, one ink — deliberately not badges. A trophy shelf would make
   * the atlas read as a game with a scoreboard, and the marks themselves were
   * chosen to resist that: every one is either a first or a round number, so
   * there is nothing to optimise and no one to beat. See
   * `shared/utils/milestones.ts`.
   */
  import type { Milestone } from '#shared/types'

  defineProps<{ milestones: Milestone[] }>()

  const { t, locale } = useI18n()
</script>

<template>
  <ul v-if="milestones.length > 0" class="flex flex-wrap gap-2" :aria-label="t('milestones.title')">
    <li
      v-for="milestone in milestones"
      :key="milestone.mark"
      class="rounded-notebook border border-dashed border-bronze-400 px-3 py-1.5 dark:border-bronze-600"
    >
      <p class="eyebrow !text-bronze-700 dark:!text-bronze-400">
        {{ t(`milestones.${milestone.mark}.label`) }}
      </p>
      <p class="mt-0.5 text-xs text-ink-600 dark:text-paper-300">
        {{ t(`milestones.${milestone.mark}.note`) }}
        <time v-if="milestone.at" :datetime="milestone.at" class="datum">
          · {{ formatDate(milestone.at, locale) }}
        </time>
      </p>
    </li>
  </ul>
</template>
