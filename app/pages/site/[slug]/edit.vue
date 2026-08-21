<script setup lang="ts">
  import type { LonLat, SiteDetail } from '#shared/types'

  definePageMeta({ layout: 'reading', middleware: 'authenticated' })

  const route = useRoute()
  const toast = useToast()

  const { data: site, refresh } = await useFetch<SiteDetail>(
    () => `/api/sites/slug/${route.params.slug}`,
  )

  if (!site.value) {
    throw createError({ statusCode: 404, statusMessage: 'No site recorded under that name.' })
  }

  useHead({ title: () => `Editing ${site.value?.title ?? ''}` })

  /**
   * Position is edited numerically here rather than by dragging a pin. Moving a
   * site is rare and consequential, and a text field makes it deliberate — the
   * map page is the right place for placing something new.
   */
  const position = ref<LonLat>({
    lon: site.value.position.lon,
    lat: site.value.position.lat,
  })

  const initial = computed(() => ({
    title: site.value?.title,
    category: site.value?.category,
    summary: site.value?.summary ?? '',
    description: site.value?.description ?? '',
    periodFrom: site.value?.periodFrom ?? null,
    periodTo: site.value?.periodTo ?? null,
  }))

  const finish = async (): Promise<void> => {
    await navigateTo(`/site/${route.params.slug}`)
  }

  const cancel = (): void => {
    toast.add({ title: 'Nothing was changed.', color: 'neutral' })
    void finish()
  }
</script>

<template>
  <div v-if="site" class="space-y-6">
    <header>
      <NuxtLink
        :to="`/site/${site.slug}`"
        class="eyebrow inline-flex items-center gap-1 hover:text-oxide-600"
      >
        <UIcon name="i-lucide-arrow-left" class="size-3" />
        Back to the entry
      </NuxtLink>
    </header>

    <div class="leaf leaf-margin py-6 pr-6">
      <ContributeSiteEditorForm
        :position="position"
        :site-id="site.id"
        :initial="initial"
        @submitted="finish"
        @cancel="cancel"
      />
    </div>

    <section class="leaf leaf-margin py-6 pr-6">
      <SiteGalleryManager :site-id="site.id" :images="site.images" @changed="refresh" />
    </section>

    <section class="leaf leaf-margin py-6 pr-6">
      <ContributeImageUploader :site-id="site.id" @uploaded="refresh" />
    </section>

    <section class="leaf leaf-margin py-6 pr-6">
      <h2 class="eyebrow">Position</h2>
      <p class="mt-1 text-sm text-ink-500 dark:text-paper-400">
        Only change this if the recorded position is wrong. Moving a site is a substantial edit.
      </p>

      <div class="mt-3 grid grid-cols-2 gap-3">
        <UFormField label="Latitude">
          <UInput v-model.number="position.lat" type="number" step="0.00001" class="w-full" />
        </UFormField>
        <UFormField label="Longitude">
          <UInput v-model.number="position.lon" type="number" step="0.00001" class="w-full" />
        </UFormField>
      </div>
    </section>
  </div>
</template>
