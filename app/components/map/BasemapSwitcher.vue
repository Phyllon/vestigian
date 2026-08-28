<script setup lang="ts">
  import type { BasemapView } from '#shared/types'

  const { view, setView, availableViews } = useBasemapStyle()
  const isOpen = ref(false)

  const choose = (next: BasemapView): void => {
    setView(next)
    isOpen.value = false
  }

  const activeLabel = computed(
    () => availableViews.find((option) => option.value === view.value)?.label ?? 'Vestigia',
  )
</script>

<template>
  <div class="relative">
    <!--
      The label is hidden below `sm`, which is where most of the traffic is, so
      the accessible name cannot come from it: on a phone this was a button
      with no name at all, announced as "button".
    -->
    <button
      type="button"
      class="leaf flex items-center gap-2 px-3 py-2 text-sm text-ink-700 transition hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-night-700"
      :aria-expanded="isOpen"
      :aria-label="`Basemap: ${activeLabel}`"
      aria-haspopup="menu"
      aria-controls="basemap-choices"
      @click="isOpen = !isOpen"
    >
      <UIcon
        name="i-lucide-layers"
        class="size-4 text-oxide-600 dark:text-oxide-300"
        aria-hidden="true"
      />
      <span class="hidden sm:inline">{{ activeLabel }}</span>
    </button>

    <Transition
      enter-active-class="transition duration-200 ease-out"
      leave-active-class="transition duration-150 ease-in"
      enter-from-class="opacity-0 translate-y-1"
      leave-to-class="opacity-0 translate-y-1"
    >
      <div
        v-if="isOpen"
        id="basemap-choices"
        role="menu"
        aria-label="Basemap"
        class="leaf absolute right-0 top-full z-20 mt-2 w-60 overflow-hidden shadow-lifted"
      >
        <button
          v-for="option in availableViews"
          :key="option.value"
          type="button"
          role="menuitemradio"
          :aria-checked="option.value === view"
          class="flex w-full flex-col items-start gap-0.5 border-b border-paper-200 px-4 py-3 text-left transition last:border-b-0 hover:bg-paper-100 dark:border-night-700 dark:hover:bg-night-700"
          :class="option.value === view ? 'bg-paper-100 dark:bg-night-700' : ''"
          @click="choose(option.value)"
        >
          <span class="flex w-full items-center justify-between">
            <span class="font-medium text-ink-900 dark:text-paper-100">{{ option.label }}</span>
            <UIcon
              v-if="option.value === view"
              name="i-lucide-check"
              class="size-4 text-oxide-600 dark:text-oxide-300"
              aria-hidden="true"
            />
          </span>
          <span class="text-xs text-ink-500 dark:text-paper-400">{{ option.hint }}</span>
        </button>
      </div>
    </Transition>
  </div>
</template>
