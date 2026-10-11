<script setup lang="ts">
  /**
   * The switches that change how the map is read rather than what it shows —
   * the "featured nearby" list, and counted clusters against every site — in one
   * control instead of one floating button each. The list's own size ("big
   * picture") is not here: it is a button in the list's header, next to the
   * thing it resizes.
   *
   * What is drawn on the map stays in `OverlaySwitcher`; this holds the readings
   * of it. The popover is Nuxt UI's (Reka UI underneath): focus, Escape, outside
   * click and the trigger's `aria-expanded` are its own, and it stays open while a
   * switch is flipped, because the change happens behind it and closing would hide
   * the only feedback that anything did. Its content is not rendered until it
   * opens, so the switches cost nothing until someone looks for them.
   */
  const { isEnabled, restore, setEnabled } = useFeaturedSites()
  const { isShowingSites, isClusteringSites, setSitesClustered } = useBasemapStyle()
  const { t } = useI18n()

  const isOpen = ref(false)

  const featuredModel = computed({
    get: () => isEnabled.value,
    set: setEnabled,
  })

  // The density control is about the sites layer; with it off there is nothing
  // for the switch to change, so the row is left out rather than shown dead.
  const everySiteModel = computed({
    get: () => !isClusteringSites.value,
    set: (showEverySite: boolean) => setSitesClustered(!showEverySite),
  })

  const popoverContent = { side: 'left', align: 'end', sideOffset: 8 } as const

  // Nuxt UI draws an off switch in `bg-accented`, a tint barely darker than the
  // sheet it sits on — the thumb showed and the track did not. These tokens give
  // the track at least 3:1 against the popover's own ground (WCAG 1.4.11).
  const switchUi = {
    base: 'data-[state=unchecked]:bg-ink-400 dark:data-[state=unchecked]:bg-paper-500',
    // `text-muted` is the ink palette's 500 step, which on the night sheet is dim
    // enough to fail 4.5:1; the rest of the app's secondary text uses these.
    description: 'text-ink-500 dark:text-paper-400',
  }

  // The saved choice is applied here as well as by the list itself, so the
  // switches are right whichever of the two mounts first.
  onMounted(restore)
</script>

<template>
  <UPopover
    v-model:open="isOpen"
    :content="popoverContent"
    :ui="{
      content:
        'z-40 max-h-[70dvh] w-72 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-[var(--radius-notebook)] border border-paper-300 bg-[var(--surface-raised)] shadow-[var(--shadow-lifted)] ring-0 dark:border-night-600',
    }"
  >
    <button
      type="button"
      class="leaf grid size-11 place-items-center text-ink-700 transition hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-night-700"
      :aria-label="t('mapSettings.label')"
      :title="t('mapSettings.label')"
      data-tour="settings"
    >
      <UIcon name="i-lucide-settings" class="size-5" aria-hidden="true" />
    </button>

    <template #content>
      <h2 class="eyebrow border-b border-paper-200 px-4 pb-2 pt-3 dark:border-night-700">
        {{ t('mapSettings.label') }}
      </h2>

      <ul>
        <li class="border-b border-paper-200 px-4 py-3 last:border-b-0 dark:border-night-700">
          <USwitch
            v-model="featuredModel"
            :ui="switchUi"
            :label="t('mapSettings.featured')"
            aria-describedby="map-settings-featured-hint"
          >
            <template #description>
              <span id="map-settings-featured-hint">{{ t('mapSettings.featuredHint') }}</span>
            </template>
          </USwitch>
        </li>

        <li v-if="isShowingSites" class="px-4 py-3">
          <USwitch
            v-model="everySiteModel"
            :ui="switchUi"
            :label="t('mapSettings.everySite')"
            aria-describedby="map-settings-every-site-hint"
          >
            <template #description>
              <span id="map-settings-every-site-hint">{{ t('mapSettings.everySiteHint') }}</span>
            </template>
          </USwitch>
        </li>
      </ul>
    </template>
  </UPopover>
</template>
