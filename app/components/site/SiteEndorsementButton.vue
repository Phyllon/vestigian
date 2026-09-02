<script setup lang="ts">
  /**
   * "Found this useful" — positive-only, one per reader per site, open to
   * anyone signed in regardless of whether they used the visit-tracking
   * feature at all. See `server/database/schema/endorsements.ts` for why this
   * is not part of the private notebook: the count is public from the moment
   * it is written, unlike a visit or a bookmark.
   *
   * `defineModel` rather than a plain prop, because `useSiteEndorsement`
   * writes a whole new `SiteDetail` object back into the ref it is given —
   * `SiteDetailPanel` and `/site/[slug]` each hold their own independent copy
   * of the record, and a plain prop would only update this component's own
   * local value, leaving the parent's `endorsementCount` stale everywhere
   * else it is read on the same page.
   */
  import type { SiteDetail } from '#shared/types'

  const site = defineModel<SiteDetail>({ required: true })

  const { t } = useI18n()
  const { loggedIn } = useSession()
  const { toggle, isSaving } = useSiteEndorsement(site)
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <UButton
      v-if="loggedIn"
      type="button"
      size="sm"
      :color="site.endorsedByMe ? 'success' : 'neutral'"
      :variant="site.endorsedByMe ? 'soft' : 'outline'"
      icon="i-lucide-thumbs-up"
      :loading="isSaving"
      :aria-pressed="site.endorsedByMe"
      @click="toggle"
    >
      {{ site.endorsedByMe ? t('siteDetail.endorsedByMe') : t('siteDetail.endorse') }}
    </UButton>

    <p v-if="site.endorsementCount > 0" class="datum text-xs text-ink-500 dark:text-paper-400">
      {{ t('siteDetail.endorsementCount', site.endorsementCount) }}
    </p>
  </div>
</template>
