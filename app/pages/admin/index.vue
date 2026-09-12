<script setup lang="ts">
  import { ADMIN_SECTIONS } from '#shared/types'
  import type { AdminSection, AdminSystemResponse } from '#shared/types'

  /**
   * One station rather than five pages.
   *
   * Everything an administrator does here is one movement — notice something in
   * the attention strip, find the account it belongs to, read what they did,
   * decide. Splitting that across routes would mean losing the filter you
   * arrived with every time you followed a name. So the sections are panels in
   * one shell, and the shell keeps its state in the query string, which buys
   * the two things separate routes would have given anyway: a view survives a
   * reload, and a view can be sent to somebody.
   *
   * Each section reads its own filters off that query string rather than being
   * handed them as props. The shell therefore passes nothing down but a `:key`,
   * which also avoids putting one section's state on a `<div>` as a stray
   * attribute for the four that do not use it.
   */
  const { t } = useI18n()
  const route = useRoute()
  const router = useRouter()

  definePageMeta({ layout: 'reading', middleware: 'admin' })
  useHead({ title: t('admin.title') })
  useNoIndex()

  const isSection = (value: unknown): value is AdminSection =>
    ADMIN_SECTIONS.includes(value as AdminSection)

  const section = computed<AdminSection>(() =>
    isSection(route.query.section) ? route.query.section : 'activity',
  )

  const goToSection = (next: AdminSection): void => {
    // Filters belong to the section that owns them, so switching sections
    // drops them rather than carrying a stale `status=pending` into the audit
    // log where it means nothing.
    void router.replace({ query: { section: next } })
  }

  const focusAccount = (userId: number | null): void => {
    void router.replace({
      query: { section: 'accounts', account: userId ?? undefined },
    })
  }

  /**
   * `server: false` throughout the panel, for the reason `AuthAccountMenu`
   * already documents: the app is served behind a CDN and nothing in
   * `routeRules` forbids page-level edge caching, so admin-visible data —
   * registered email addresses, one person's whole history — must never be
   * baked into server-rendered HTML. The `no-store` header on `/admin/**` is
   * the other half of the same argument.
   *
   * Keyed, so a section that has just blocked somebody can bring the attention
   * strip up to date with `refreshNuxtData(ADMIN_SYSTEM_KEY)` instead of
   * emitting an event up through a `<component :is>` the shell deliberately
   * passes nothing through.
   *
   * Not awaited: `server: false` means nothing is fetched during SSR, so an
   * `await` here would make the page itself an async-setup component,
   * implicitly wrapped in `<Suspense>` — rendering nothing server-side and
   * then blocking hydration on the client until the fetch resolves. The two
   * renders disagree by construction, and Vue's hydration mismatch was
   * surfacing as this application's fatal error page on every visit.
   */
  const { data: system } = useFetch<AdminSystemResponse>('/api/admin/system', {
    key: ADMIN_SYSTEM_KEY,
    server: false,
  })

  const attention = computed(() => system.value?.attention ?? null)
</script>

<template>
  <div>
    <header class="mb-5">
      <p class="eyebrow text-ink-500 dark:text-paper-400">{{ t('admin.eyebrow') }}</p>
      <h1 class="mt-1 text-3xl">{{ t('admin.title') }}</h1>
      <p class="mt-1 max-w-prose text-sm text-ink-500 dark:text-paper-400">
        {{ t('admin.intro') }}
      </p>
    </header>

    <AdminCommandBar
      :section="section"
      :attention="attention"
      :status="system?.status ?? null"
      @update:section="goToSection"
      @focus-account="focusAccount"
    />

    <!--
      One live section, mounted lazily. The activity stream renders a diff per
      row and the dossier fetches nine queries; mounting all five to hide four
      would make opening the panel cost everything the panel can do.

      `:key` so switching remounts rather than reusing a component with
      another section's cursor still in it.

      `ClientOnly`, wrapping all of it — not `server: false` on each fetch
      alone. Every section here fetches privileged data through a `Lazy`
      (dynamically imported) component, and that combination has a real
      hydration bug: the dynamic import defers the component's own mount
      past the point Vue expects to reconcile it against the server-rendered
      markup, so by the time it actually mounts on the client the fetch has
      already moved `status` past whatever SSR rendered (`server: false`
      renders nothing at all), and hydration diffs a node that was never
      going to match. That surfaced as this page's own fatal error on every
      visit — `app/error.vue`'s "Something gave way" — because the mismatch
      is a thrown exception, not a warning, inside a Suspense-wrapped async
      component. `ClientOnly` sidesteps the entire class of failure by never
      asking the server to render this subtree in the first place, which is
      also the more honest match for data that must never reach
      server-rendered HTML at all (see the note above on why `server: false`
      is used throughout).
    -->
    <ClientOnly>
      <section class="mt-5" :aria-label="t(`admin.sections.${section}`)">
        <LazyAdminActivityStream v-if="section === 'activity'" :key="section" />
        <LazyAdminAccountTable v-else-if="section === 'accounts'" :key="section" />
        <LazyAdminImageQueue v-else-if="section === 'images'" :key="section" />
        <LazyAdminAuditLog v-else-if="section === 'audit'" :key="section" />
        <LazyAdminSystemPanel v-else :key="section" :system="system ?? null" />
      </section>

      <template #fallback>
        <p class="datum mt-5">{{ t('admin.loading') }}</p>
      </template>
    </ClientOnly>
  </div>
</template>
