<script setup lang="ts">
  import type { LimesSector } from '#shared/types'

  /**
   * The frontier as a document rather than as a layer.
   *
   * The map answers the question standing over it; this one is what a reader
   * links to, cites, and finds from a search engine — which the map, being one
   * URL with the camera in the hash, cannot be. Rendered on the server for the
   * same reason.
   */
  const { data: sectors } = await useFetch<LimesSector[]>('/api/limes/sectors')

  const totalLength = computed(() =>
    (sectors.value ?? []).reduce((sum, sector) => sum + sector.lengthMetres, 0),
  )

  useHead({ title: 'The limes' })
  useSeoMeta({
    description:
      'The frontier of the Roman empire, sector by sector: its walls, its rivers and the forts and watchtowers along them.',
  })

  definePageMeta({ layout: 'reading' })
</script>

<template>
  <article>
    <h1 class="font-display text-3xl text-ink-900 dark:text-paper-100">The limes</h1>

    <p class="mt-4 text-base leading-relaxed text-ink-700 dark:text-paper-200">
      The edge of the Roman world, from the Solway to the Euphrates. It was never one thing: a
      mortared wall across the Raetian plateau, a river patrolled from its western bank, a line of
      forts at the last reliable water before the desert. What follows is that edge in the stretches
      the sources name, drawn from the Ancient World Mapping Center's extent of the empire at 200 CE
      and from its record of the walls that were actually built.
    </p>

    <p class="mt-3 font-mono text-sm text-ink-500 dark:text-paper-400">
      {{ formatFrontierLength(totalLength) }} across {{ sectors?.length ?? 0 }} stretches
    </p>

    <ul class="mt-8 flex flex-col">
      <li
        v-for="sector in sectors"
        :key="sector.slug"
        class="border-t border-paper-200 py-4 last:border-b dark:border-night-700"
      >
        <NuxtLink :to="`/limes/${sector.slug}`" class="group block">
          <h2
            class="font-display text-xl text-ink-900 group-hover:text-oxide-700 dark:text-paper-100 dark:group-hover:text-oxide-300"
          >
            {{ sector.name }}
          </h2>
          <p v-if="sector.latinName" class="font-mono text-xs text-ink-500 dark:text-paper-400">
            {{ sector.latinName }}
          </p>
          <p class="mt-1.5 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
            {{ sector.summary }}
          </p>
          <p class="mt-1.5 font-mono text-xs text-ink-500 dark:text-paper-400">
            {{ formatFrontierLength(sector.lengthMetres) }} ·
            {{ formatFrontierYears(sector.minYear, sector.maxYear) }}
          </p>
        </NuxtLink>
      </li>
    </ul>

    <p class="mt-8 text-xs leading-relaxed text-ink-500 dark:text-paper-400">
      Frontier derived from the
      <a href="https://github.com/AWMC/geodata" rel="noopener" class="underline underline-offset-2">
        Ancient World Mapping Center</a
      >'s extent of the empire and its wall linework, ODbL 1.0. The names and the notes above are
      this atlas's own; the geometry is not.
    </p>
  </article>
</template>
