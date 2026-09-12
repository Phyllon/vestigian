<script setup lang="ts">
  import type { AdminImagesResponse } from '#shared/types'

  /**
   * Photographs waiting for a decision, and photographs that must never get
   * one.
   *
   * The second set is why this section exists. An image whose licence is
   * `UNKNOWN` or `ARR` is never published — a hard rule in the security
   * invariants — but nothing in this application listed them: they were
   * reachable only by opening the site page they hang off, which is no use for
   * finding the ones nobody has opened. A rule enforced at render time with no
   * way to audit its inputs is a rule taken on trust.
   */
  const { t } = useI18n()
  const router = useRouter()

  const filter = ref<'pending' | 'unlicensed' | 'all'>('pending')

  /**
   * Not awaited, deliberately. `server: false` means nothing is fetched
   * during SSR, so an `await` here would turn this into an async-setup
   * component — implicitly wrapped in `<Suspense>` — that renders nothing
   * server-side and then blocks hydration on the client until the fetch
   * resolves. The two renders disagree by construction, and Vue's hydration
   * mismatch was surfacing as this application's fatal error page. Leaving
   * the call unawaited keeps `data`/`fetchStatus` at their initial values on
   * both sides, matching, and the real values arrive as an ordinary reactive
   * update once the fetch completes after mount.
   */
  const { data, status: fetchStatus } = useFetch<AdminImagesResponse>('/api/admin/images', {
    server: false,
    query: computed(() => ({ filter: filter.value, limit: 40 })),
  })

  const images = computed(() => data.value?.images ?? [])

  const focusAccount = (userId: number): void => {
    void router.replace({ query: { section: 'accounts', account: userId } })
  }
</script>

<template>
  <div class="space-y-4">
    <div class="leaf px-3 py-3 sm:px-4">
      <UFormField :label="t('admin.images.filterLabel')">
        <USelect
          v-model="filter"
          size="sm"
          class="w-56"
          :items="[
            { label: t('admin.images.filters.pending'), value: 'pending' },
            { label: t('admin.images.filters.unlicensed'), value: 'unlicensed' },
            { label: t('admin.images.filters.all'), value: 'all' },
          ]"
        />
      </UFormField>
    </div>

    <p v-if="fetchStatus === 'pending'" class="datum">{{ t('admin.images.loading') }}</p>

    <ul v-else class="space-y-3">
      <li v-for="image in images" :key="image.id" class="leaf px-3 py-3 sm:px-4">
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 class="text-base text-ink-900 dark:text-paper-100">
            <NuxtLink
              :to="`/site/${image.siteSlug}`"
              class="underline decoration-dotted underline-offset-2"
            >
              {{ image.siteTitle }}
            </NuxtLink>
          </h3>

          <!--
            The one urgent mark in this section: an unresolved licence is a
            rule being broken, not a queue being long.
          -->
          <span v-if="image.licenceUnresolved" class="eyebrow text-oxide-600 dark:text-oxide-300">
            {{ t('admin.images.cannotPublish') }}
          </span>

          <span class="datum ml-auto">
            {{ image.licence }} · {{ image.width }}×{{ image.height }}
          </span>
        </div>

        <p class="mt-0.5 text-sm text-ink-500 dark:text-paper-400">
          {{ t(`admin.images.status.${image.status}`) }}
          ·
          <button
            v-if="image.uploaderId"
            type="button"
            class="underline decoration-dotted underline-offset-2 hover:text-ink-900 dark:hover:text-paper-100"
            :aria-label="t('admin.images.openUploaderAria', { name: image.uploaderName ?? '' })"
            @click="focusAccount(image.uploaderId)"
          >
            {{ image.uploaderName ?? t('admin.images.deletedAccount') }}
          </button>
          <span v-else>{{ t('admin.images.deletedAccount') }}</span>
        </p>

        <p v-if="image.caption" class="mt-1 text-sm text-ink-700 dark:text-paper-200">
          {{ image.caption }}
        </p>

        <p v-if="image.attribution" class="datum mt-1">{{ image.attribution }}</p>

        <!--
          A link out rather than a thumbnail. Reviewing a licence means reading
          the source page, and rendering forty derivatives through imgproxy to
          decorate a governance screen would cost more than it tells anyone.
        -->
        <p v-if="image.sourceUrl" class="mt-1 text-sm">
          <a
            :href="image.sourceUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="text-bronze-600 underline decoration-dotted underline-offset-2 dark:text-bronze-300"
          >
            {{ t('admin.images.openSource') }}
          </a>
        </p>

        <p class="mt-2">
          <NuxtLink
            :to="`/site/${image.siteSlug}`"
            class="text-sm text-ink-500 underline decoration-dotted underline-offset-2 dark:text-paper-400"
          >
            {{ t('admin.images.manageOnSite') }}
          </NuxtLink>
        </p>
      </li>
    </ul>

    <p v-if="fetchStatus !== 'pending' && images.length === 0" class="datum">
      {{ t('admin.images.empty') }}
    </p>
  </div>
</template>
