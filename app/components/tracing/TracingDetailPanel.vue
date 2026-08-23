<script setup lang="ts">
  const { tracing, selectTracing, isTracingPanelOpen } = useSiteQuery()
  const { loggedIn } = useSession()
  const { isCompact } = useBreakpoint()

  const close = (): void => selectTracing(null)

  const length = computed(() => formatLength(tracing.value?.lengthMetres ?? null))

  const handleEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && isTracingPanelOpen.value) close()
  }

  onMounted(() => {
    window.addEventListener('keydown', handleEscape)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', handleEscape)
  })
</script>

<template>
  <Transition
    :enter-active-class="
      isCompact
        ? 'transition-transform duration-300 ease-out'
        : 'transition-all duration-300 ease-out'
    "
    :leave-active-class="
      isCompact
        ? 'transition-transform duration-200 ease-in'
        : 'transition-all duration-200 ease-in'
    "
    :enter-from-class="isCompact ? 'translate-y-full' : 'translate-x-full opacity-0'"
    :leave-to-class="isCompact ? 'translate-y-full' : 'translate-x-full opacity-0'"
  >
    <aside
      v-if="isTracingPanelOpen && tracing"
      class="pointer-events-auto fixed inset-x-0 bottom-0 z-30 max-h-[70vh] overflow-y-auto rounded-t-lg bg-paper-50 shadow-lifted md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[26rem] md:rounded-none md:border-l md:border-paper-200 dark:bg-night-800 dark:md:border-night-700"
      aria-label="Tracing details"
    >
      <div class="sticky top-0 z-10 bg-paper-50 pt-2 dark:bg-night-800 md:pt-0">
        <div class="mx-auto mb-1 h-1 w-10 rounded-full bg-paper-300 dark:bg-night-600 md:hidden" />
        <div
          class="flex items-start justify-between gap-3 border-b border-paper-200 px-5 py-3 dark:border-night-700"
        >
          <p class="eyebrow pt-1">{{ tracing.kind === 'area' ? 'Area' : 'Route' }}</p>
          <button
            type="button"
            class="grid size-8 shrink-0 place-items-center rounded-notebook text-ink-500 transition hover:bg-paper-200 dark:text-paper-400 dark:hover:bg-night-700"
            aria-label="Close tracing details"
            @click="close"
          >
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </div>
      </div>

      <article class="px-5 py-5">
        <h1 class="text-2xl leading-tight">{{ tracing.title }}</h1>

        <dl
          class="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-y border-paper-200 py-3 dark:border-night-700"
        >
          <dt class="eyebrow pt-0.5">Type</dt>
          <dd class="text-sm text-ink-700 dark:text-paper-200">{{ tracing.category }}</dd>

          <template v-if="length">
            <dt class="eyebrow pt-0.5">Length</dt>
            <dd class="datum">{{ length }}</dd>
          </template>
        </dl>

        <p
          class="mt-4 rounded-notebook bg-paper-100 px-3 py-2 text-xs text-ink-500 dark:bg-night-700 dark:text-paper-400"
        >
          Traced routes are drawn dashed because a tracing is an interpretation of where something
          ran, not a survey of it.
        </p>

        <div
          v-if="tracing.description"
          class="mt-5 space-y-3 text-[0.95rem] leading-relaxed text-ink-700 dark:text-paper-200"
        >
          <p v-for="(paragraph, index) in tracing.description.split('\n\n')" :key="index">
            {{ paragraph }}
          </p>
        </div>

        <div
          class="mt-8 flex flex-wrap items-center gap-3 border-t border-paper-200 pt-3 dark:border-night-700"
        >
          <NuxtLink
            :to="`/tracing/${tracing.id}`"
            class="text-sm text-oxide-600 underline underline-offset-2 dark:text-oxide-300"
          >
            Open the full entry
          </NuxtLink>
          <NuxtLink
            v-if="loggedIn"
            :to="`/tracing/${tracing.id}/edit`"
            class="text-sm text-ink-500 underline underline-offset-2 dark:text-paper-400"
          >
            Edit
          </NuxtLink>
          <p class="datum ml-auto">
            {{ tracing.attribution ?? 'Vestigia contributors' }}
          </p>
        </div>
      </article>
    </aside>
  </Transition>
</template>
