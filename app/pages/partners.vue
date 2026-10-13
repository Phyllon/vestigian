<script setup lang="ts">
  import { listPartners } from '#shared/utils/partners'

  /**
   * The organisations that have agreed terms with us and asked to be named, each in
   * its own words. Everything this page promises is the promise made to sources in
   * `documents/source-permissions/` — alphabetical, no paid placement, nothing
   * altered silently, withdrawal by one email — so a change here is a change to what
   * was offered, and the two move together. See `.claude/rules/partners.md`.
   *
   * With no real partner yet the list is empty and says so, which is the honest
   * state of a new project. The invented examples are shown under `nuxt dev` and
   * where a deployment asks for them (`showExamplePartners`), and always under a
   * notice that they are invented.
   */
  const { t, n, locale } = useI18n()
  const { availableLocales } = useUiLocale()
  const config = useRuntimeConfig()
  const base = config.public.siteUrl.replace(/\/$/, '')

  const showExamples = import.meta.dev || config.public.showExamplePartners
  const partners = computed(() => listPartners({ includeExamples: showExamples }))
  const hasExamples = computed(() => partners.value.some((partner) => partner.isExample === true))

  const promiseKeys = [
    'promiseCredit',
    'promiseApart',
    'promiseUnaltered',
    'promiseWithdraw',
  ] as const

  /**
   * One file per interface language, so a partner's German site can carry the German
   * badge. The page shows the reader's own language and offers the rest as downloads.
   */
  const badgePath = (code: string): string => `/partner-assets/badge/seen-on-vestigian.${code}.svg`
  /**
   * The `src` is the bare file name on purpose: the badge is downloaded and hosted by
   * the partner, never hot-linked, so there is no path on our server for it to name.
   * A pasted snippet that pointed at our origin would make every visitor to their site
   * request ours. The comment on top says where the file goes, and travels with the paste.
   */
  const badgeSnippet = computed(
    () =>
      `<!-- ${t('partnersPage.badgeSnippetNote')} -->\n<a href="${base}/">\n  <img src="seen-on-vestigian.${locale.value}.svg" alt="${t('partnersPage.badgeAlt')}" width="220" height="40">\n</a>`,
  )

  useHead({ title: t('partnersPage.title') })
  useSeoMeta({ description: t('partnersPage.intro') })
  useCanonicalUrl()

  useSocialMeta({
    title: t('partnersPage.title'),
    description: t('partnersPage.intro'),
    imageUrl: `${base}/og/default.png`,
  })

  definePageMeta({ layout: 'reading' })
</script>

<template>
  <article class="relative">
    <UiPageContents />

    <h1 class="font-display text-3xl text-ink-900 dark:text-paper-100">
      {{ t('partnersPage.title') }}
    </h1>

    <p class="mt-4 text-base leading-relaxed text-ink-700 dark:text-paper-200">
      {{ t('partnersPage.intro') }}
    </p>

    <!--
      Said once, at the top, and again on each card as a tag: a screenshot of one card
      must not read as a real organisation having agreed to anything.
    -->
    <UAlert
      v-if="hasExamples"
      class="mt-6"
      color="neutral"
      variant="outline"
      icon="i-lucide-flask-conical"
      :title="t('partnersPage.exampleTitle')"
      :description="t('partnersPage.exampleBody')"
    />

    <section class="mt-8 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 id="promises" class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('partnersPage.promisesHeading') }}
      </h2>
      <ul
        class="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-700 marker:text-ink-500 dark:text-paper-200 dark:marker:text-paper-400"
      >
        <li v-for="key in promiseKeys" :key="key">{{ t(`partnersPage.${key}`) }}</li>
      </ul>
    </section>

    <section
      class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700"
      aria-labelledby="partners-list-heading"
    >
      <h2 id="partners-list-heading" class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('partnersPage.listHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-500 dark:text-paper-400">
        {{ t('partnersPage.orderNote') }}
      </p>

      <ul v-if="partners.length > 0" class="mt-4 space-y-5">
        <li v-for="partner in partners" :id="partner.id" :key="partner.id" class="scroll-mt-20">
          <article class="leaf p-5" :aria-labelledby="`${partner.id}-name`">
            <header class="flex items-start gap-4">
              <!--
                The mark is decorative: the name is the heading beside it, so a
                description would be read twice. A recolourable mark is a mask over its
                own shape, drawn in the page's ink — it follows light and dark mode and
                cannot clash with the accent. One whose owner forbids recolouring is
                shown as supplied.
              -->
              <span
                v-if="partner.mark?.isRecolourable"
                class="size-14 shrink-0 bg-ink-700 [mask-image:var(--partner-mark)] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain] dark:bg-paper-200"
                :style="{ '--partner-mark': `url(${partner.mark.path})` }"
                aria-hidden="true"
              />
              <img
                v-else-if="partner.mark"
                :src="partner.mark.path"
                alt=""
                width="56"
                height="56"
                class="size-14 shrink-0 object-contain"
              />

              <div class="min-w-0">
                <h3
                  :id="`${partner.id}-name`"
                  class="font-display text-xl text-ink-900 dark:text-paper-100"
                >
                  {{ partner.name }}
                </h3>
                <p
                  class="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-ink-500 dark:text-paper-400"
                >
                  <span>{{ t(`partnersPage.kind.${partner.kind}`) }}</span>
                  <span
                    v-if="partner.isExample"
                    class="rounded-full border border-ink-400 px-2 text-xs leading-5 text-ink-700 dark:border-paper-500 dark:text-paper-200"
                  >
                    {{ t('partnersPage.exampleTag') }}
                  </span>
                </p>
              </div>
            </header>

            <p class="mt-4 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
              <span class="eyebrow mb-1 block text-ink-500 dark:text-paper-400">
                {{ t('partnersPage.inTheirWords') }}
              </span>
              {{ t(`partnersPage.entries.${partner.id}.about`) }}
            </p>

            <dl class="mt-4 grid gap-x-4 gap-y-3 text-sm sm:grid-cols-[9rem_1fr]">
              <dt class="eyebrow pt-0.5 text-ink-500 dark:text-paper-400">
                {{ t('partnersPage.drawnLabel') }}
              </dt>
              <dd class="text-ink-700 dark:text-paper-200">
                {{ t(`partnersPage.entries.${partner.id}.drawn`) }}
                <span
                  v-if="partner.recordCount !== undefined"
                  class="font-mono text-xs text-ink-500 dark:text-paper-400"
                >
                  · {{ t('partnersPage.recordCount', { count: n(partner.recordCount) }) }}
                </span>
              </dd>

              <dt class="eyebrow pt-0.5 text-ink-500 dark:text-paper-400">
                {{ t('partnersPage.citeLabel') }}
              </dt>
              <dd
                class="break-words font-mono text-xs leading-relaxed text-ink-700 dark:text-paper-200"
              >
                {{ partner.citation }}
              </dd>
            </dl>

            <p class="mt-4">
              <a
                :href="partner.url"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1.5 text-sm text-ink-900 underline decoration-paper-400 underline-offset-2 hover:text-oxide-600 dark:text-paper-100 dark:hover:text-oxide-300"
              >
                {{ t('partnersPage.visitSite', { name: partner.name }) }}
                <UIcon name="i-lucide-external-link" class="size-3.5" aria-hidden="true" />
                <span class="sr-only">{{ t('partnersPage.opensInNewTab') }}</span>
              </a>
            </p>
          </article>
        </li>
      </ul>

      <div v-else class="leaf mt-4 p-5">
        <h3 class="font-display text-lg text-ink-900 dark:text-paper-100">
          {{ t('partnersPage.emptyTitle') }}
        </h3>
        <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
          {{ t('partnersPage.emptyBody') }}
        </p>
      </div>
    </section>

    <section
      class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700"
      aria-labelledby="partners-badge-heading"
    >
      <h2 id="partners-badge-heading" class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('partnersPage.badgeHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('partnersPage.badgeBody') }}
      </p>

      <p class="mt-4">
        <img
          :src="badgePath(locale)"
          :alt="t('partnersPage.badgeAlt')"
          width="220"
          height="40"
          class="h-10 w-[220px] max-w-full"
        />
      </p>

      <p class="eyebrow mt-4 text-ink-500 dark:text-paper-400">
        {{ t('partnersPage.badgeDownload') }}
      </p>
      <ul class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-700 dark:text-paper-200">
        <li v-for="option in availableLocales" :key="option.code">
          <a
            :href="badgePath(option.code)"
            :download="`seen-on-vestigian.${option.code}.svg`"
            :lang="option.code"
            class="inline-flex items-center gap-1 underline decoration-paper-400 underline-offset-2 hover:text-oxide-600 dark:hover:text-oxide-300"
          >
            <UIcon name="i-lucide-download" class="size-3.5" aria-hidden="true" />
            {{ option.name }}
          </a>
        </li>
      </ul>

      <p class="eyebrow mt-4 text-ink-500 dark:text-paper-400">
        {{ t('partnersPage.badgeSnippet') }}
      </p>
      <!-- `select-all`: one click selects the whole snippet, no script involved. -->
      <pre
        class="mt-1 select-all overflow-x-auto rounded-notebook border border-paper-200 bg-paper-50 p-3 font-mono text-xs leading-relaxed text-ink-900 dark:border-night-700 dark:bg-night-800 dark:text-paper-100"
      ><code>{{ badgeSnippet }}</code></pre>
    </section>

    <section
      class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700"
      aria-labelledby="partners-credit-heading"
    >
      <h2
        id="partners-credit-heading"
        class="font-display text-xl text-ink-900 dark:text-paper-100"
      >
        {{ t('licence.reuseCreditHeading') }}
      </h2>
      <UiCreditLine class="mt-3" />
    </section>

    <section class="mt-6 border-t border-paper-200 pt-4 dark:border-night-700">
      <h2 id="how" class="font-display text-xl text-ink-900 dark:text-paper-100">
        {{ t('partnersPage.howHeading') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('partnersPage.howBody') }}
      </p>
      <p class="mt-3 text-sm leading-relaxed text-ink-700 dark:text-paper-200">
        {{ t('partnersPage.howContact') }}
        <NuxtLink
          to="/impressum"
          class="underline underline-offset-2 hover:text-oxide-600 dark:hover:text-oxide-300"
        >
          {{ t('impressum.title') }}
        </NuxtLink>
        <span aria-hidden="true"> · </span>
        <NuxtLink
          to="/licence"
          class="underline underline-offset-2 hover:text-oxide-600 dark:hover:text-oxide-300"
        >
          {{ t('layout.footerLicence') }}
        </NuxtLink>
      </p>
    </section>
  </article>
</template>
