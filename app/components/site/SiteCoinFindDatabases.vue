<script setup lang="ts">
  /**
   * Where single coin finds for this site's country are recorded — links
   * out, never mirrored data. Why nothing is mirrored yet, and which sources
   * accept a findspot search in the URL (only DIME, verified live), is
   * documented on `COIN_FIND_DATABASES` (`shared/utils/coin-find-databases.ts`).
   */
  const props = defineProps<{ countryCode: string | null; siteTitle: string | null }>()

  const { t } = useI18n()
  const { countryName } = useCountryName()

  const databases = computed(() => coinFindDatabasesForCountry(props.countryCode))

  const links = computed(() =>
    databases.value.map((database) => ({
      database,
      ...coinFindDatabaseLink(database, props.siteTitle),
    })),
  )
</script>

<template>
  <!-- Most of the world has no national finds database; saying nothing is the ordinary case. -->
  <section v-if="links.length > 0">
    <h2 class="eyebrow">{{ t('siteCoinFinds.title') }}</h2>
    <p class="mt-1 text-xs text-ink-500 dark:text-paper-400">
      {{ t('siteCoinFinds.intro', { country: countryName(countryCode) }) }}
    </p>
    <ul class="mt-2 space-y-2">
      <li v-for="{ database, url, isSearch } in links" :key="database.id">
        <a
          :href="url"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1.5 text-sm text-ink-700 underline-offset-2 hover:text-oxide-600 hover:underline dark:text-paper-200 dark:hover:text-oxide-300"
        >
          {{ database.name }}
          <span class="sr-only">{{ t('siteCoinFinds.opensNewTab') }}</span>
          <UIcon name="i-lucide-arrow-up-right" class="size-3" aria-hidden="true" />
        </a>
        <p class="datum">{{ t(`siteCoinFinds.coverage.${database.id}`) }}</p>
        <!-- A search is a starting point, not a promise of a match — see the
             Vindelev/Jelling note in coin-find-databases.ts. -->
        <p v-if="isSearch" class="datum text-ink-400 dark:text-paper-500">
          {{ t('siteCoinFinds.searchPrefilled', { title: siteTitle }) }}
        </p>
      </li>
    </ul>
  </section>
</template>
