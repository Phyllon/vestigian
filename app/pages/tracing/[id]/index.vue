<script setup lang="ts">
  import type { TracingDetail } from '~/composables/data/useSiteQuery'

  definePageMeta({ layout: 'reading' })

  const route = useRoute()
  const { loggedIn } = useSession()

  const { data: tracing } = await useFetch<TracingDetail>(() => `/api/tracings/${route.params.id}`)

  if (!tracing.value) {
    throw createError({ statusCode: 404, statusMessage: 'No tracing with that identifier.' })
  }

  useHead({ title: () => tracing.value?.title })

  const length = computed(() => formatLength(tracing.value?.lengthMetres ?? null))
</script>

<template>
  <div v-if="tracing" class="space-y-6">
    <article class="leaf leaf-margin py-8 pr-8">
      <p class="eyebrow">{{ tracing.kind === 'area' ? 'Traced area' : 'Traced route' }}</p>
      <h1 class="mt-2 text-4xl leading-tight">{{ tracing.title }}</h1>

      <dl
        class="mt-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-y border-paper-200 py-3 dark:border-night-700"
      >
        <dt class="eyebrow pt-0.5">Type</dt>
        <dd class="text-sm text-ink-700 dark:text-paper-200">{{ tracing.category }}</dd>

        <template v-if="length">
          <dt class="eyebrow pt-0.5">Length</dt>
          <dd class="datum">{{ length }}</dd>
        </template>

        <dt class="eyebrow pt-0.5">Credit</dt>
        <dd class="datum">
          {{ tracing.attribution ?? 'Vestigia contributors' }} · {{ tracing.licence }}
        </dd>
      </dl>

      <div
        v-if="tracing.description"
        class="mt-6 space-y-4 text-[1.0625rem] leading-relaxed text-ink-700 dark:text-paper-200"
      >
        <p v-for="(paragraph, index) in tracing.description.split('\n\n')" :key="index">
          {{ paragraph }}
        </p>
      </div>

      <footer
        class="mt-10 flex flex-wrap items-center gap-3 border-t border-paper-200 pt-4 dark:border-night-700"
      >
        <UButton
          v-if="loggedIn"
          :to="`/tracing/${tracing.id}/edit`"
          color="primary"
          icon="i-lucide-pencil"
        >
          Edit
        </UButton>
        <p class="datum ml-auto">
          Last revised
          {{ new Date(tracing.updatedAt).toLocaleDateString('en-GB', { dateStyle: 'medium' }) }}
        </p>
      </footer>
    </article>

    <div class="leaf leaf-margin py-6 pr-8">
      <UiRevisionHistory :entity-id="tracing.id" entity-type="tracing" />
    </div>
  </div>
</template>
