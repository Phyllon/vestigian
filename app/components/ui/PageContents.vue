<script setup lang="ts">
  /**
   * A legend for the long reading pages (licence, privacy, partners, about):
   * the page's `<h2 id>` headings as a list that jumps to each section and
   * marks the one being read.
   *
   * The list is read from the rendered headings instead of being declared per
   * page, so a section added to a page appears here with no second edit — and
   * the ids stay static in the page markup, which is what lets a shared
   * `/licence#reuse` land on its section before any script has run. Only
   * headings that carry an `id` are listed; one without is deliberately not a
   * jump target.
   *
   * Beside the column on wide screens, a collapsed disclosure above it
   * otherwise. The parent `<article>` must be `relative`: the wide variant is
   * positioned against it and sticks within its height.
   */
  interface ContentsEntry {
    id: string
    label: string
  }

  const { t, locale } = useI18n()

  const entries = ref<ContentsEntry[]>([])
  const activeId = ref<string | null>(null)

  let observer: IntersectionObserver | null = null

  const collectEntries = (): void => {
    const headings = Array.from(document.querySelectorAll<HTMLElement>('main h2[id]'))
    entries.value = headings.map((heading) => ({
      id: heading.id,
      label: heading.textContent?.trim() ?? heading.id,
    }))
    activeId.value = entries.value[0]?.id ?? null

    observer?.disconnect()
    if (headings.length < 2) return

    const visible = new Set<string>()
    // The band below the sticky header (56px) down to 35% of the viewport: the
    // heading that last crossed into it is the one being read.
    observer = new IntersectionObserver(
      (changes) => {
        for (const change of changes) {
          if (change.isIntersecting) visible.add(change.target.id)
          else visible.delete(change.target.id)
        }
        const current = headings.find((heading) => visible.has(heading.id))
        if (current) activeId.value = current.id
      },
      { rootMargin: '-72px 0px -65% 0px' },
    )
    for (const heading of headings) observer.observe(heading)
  }

  watch(locale, () => nextTick(collectEntries))

  onMounted(collectEntries)

  onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div v-if="entries.length > 1">
    <details class="leaf mb-6 px-4 py-3 min-[1200px]:hidden">
      <summary class="eyebrow cursor-pointer text-ink-700 dark:text-paper-200">
        {{ t('pageContents.title') }}
      </summary>
      <nav :aria-label="t('pageContents.title')" class="mt-3">
        <ol class="space-y-1.5 text-sm">
          <li v-for="entry in entries" :key="entry.id">
            <NuxtLink
              :to="`#${entry.id}`"
              class="block py-0.5 text-ink-700 underline decoration-paper-400 underline-offset-2 dark:text-paper-200"
            >
              {{ entry.label }}
            </NuxtLink>
          </li>
        </ol>
      </nav>
    </details>

    <aside class="absolute left-full top-0 ml-8 hidden h-full w-44 min-[1200px]:block">
      <nav :aria-label="t('pageContents.title')" class="sticky top-20">
        <p class="eyebrow mb-2 text-ink-500 dark:text-paper-400">{{ t('pageContents.title') }}</p>
        <ol class="border-l border-paper-300 dark:border-night-600">
          <li v-for="entry in entries" :key="entry.id">
            <NuxtLink
              :to="`#${entry.id}`"
              :aria-current="entry.id === activeId ? 'location' : undefined"
              class="-ml-px block border-l-2 py-1 pl-3 text-xs leading-snug transition-colors"
              :class="
                entry.id === activeId
                  ? 'border-ink-900 text-ink-900 dark:border-paper-100 dark:text-paper-100'
                  : 'border-transparent text-ink-500 hover:text-ink-900 dark:text-paper-400 dark:hover:text-paper-100'
              "
            >
              {{ entry.label }}
            </NuxtLink>
          </li>
        </ol>
      </nav>
    </aside>
  </div>
</template>
