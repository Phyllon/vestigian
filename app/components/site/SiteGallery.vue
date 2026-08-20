<script setup lang="ts">
import type { SiteImage } from '#shared/types'

const props = defineProps<{ images: SiteImage[] }>()

const { buildUrl, buildCredit } = useImageUrl()
const activeIndex = ref(0)

const activeImage = computed(() => props.images[activeIndex.value] ?? null)

const show = (index: number): void => {
  activeIndex.value = index
}
</script>

<template>
  <figure>
    <div class="overflow-hidden rounded-notebook bg-paper-200 dark:bg-night-700">
      <img
        v-if="activeImage"
        :src="buildUrl(activeImage, 'card')"
        :alt="activeImage.caption ?? 'Photograph of the site'"
        class="aspect-[3/2] w-full object-cover"
        loading="lazy"
        decoding="async"
      >
    </div>

    <figcaption v-if="activeImage" class="mt-2 space-y-1">
      <p v-if="activeImage.caption" class="text-sm text-ink-700 dark:text-paper-200">
        {{ activeImage.caption }}
      </p>
      <!-- Attribution is a licence obligation, not a nicety, so it is never
           collapsed behind an interaction. -->
      <p class="datum text-[0.6875rem]">{{ buildCredit(activeImage) }}</p>
    </figcaption>

    <div v-if="images.length > 1" class="mt-3 flex gap-2 overflow-x-auto pb-1">
      <button
        v-for="(image, index) in images"
        :key="image.id"
        type="button"
        class="size-14 shrink-0 overflow-hidden rounded-notebook border-2 transition"
        :class="index === activeIndex ? 'border-oxide-600' : 'border-transparent opacity-70 hover:opacity-100'"
        :aria-label="`Show image ${index + 1} of ${images.length}`"
        @click="show(index)"
      >
        <img :src="buildUrl(image, 'thumb')" alt="" class="size-full object-cover" loading="lazy">
      </button>
    </div>
  </figure>
</template>
