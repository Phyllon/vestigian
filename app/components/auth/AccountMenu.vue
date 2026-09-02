<script setup lang="ts">
  /**
   * Everything about the signed-in account, in one place.
   *
   * It replaces a bare button that showed the display name and signed the
   * person out when clicked — no confirmation, no dropdown, nothing else
   * reachable. The name is a label, not a control, and the only action it
   * offered was the one nobody means to take by accident.
   *
   * The moderation queue is deliberately *not* duplicated in here. It stays a
   * link in the header, because moderators open it constantly and burying a
   * working tool one click deeper to tidy the header is a bad trade.
   *
   * `ClientOnly` for a different reason than `LanguageSwitcher` and
   * `ThemeToggle`, which use it because their state is only knowable in the
   * browser. The session here *is* available during SSR, so the name could be
   * server-rendered — and must not be. This app is served behind a CDN, and a
   * display name baked into the HTML of `/` is a cross-user leak the moment
   * anyone enables edge caching for pages, which nothing in `routeRules`
   * currently forbids. The cost is the name appearing a beat after first
   * paint, exactly as the two controls beside it already do.
   */
  const { t } = useI18n()
  const { currentUser, isAdmin, editsGoLiveImmediately, contributionsUntilTrusted, signOut } =
    useSession()

  /**
   * The one line of standing. Someone on probation is told what is left rather
   * than that they are on probation: "one more accepted contribution" is a
   * sentence you can act on, "trust level 0" is not.
   */
  const standing = computed(() => {
    if (!currentUser.value) return ''
    if (editsGoLiveImmediately.value) return t('account.standingTrusted')
    return t('account.standingProbation', contributionsUntilTrusted.value)
  })

  const items = computed(() => [
    [
      { label: t('account.notebook'), icon: 'i-lucide-notebook-text', to: '/notebook' },
      { label: t('account.visits'), icon: 'i-lucide-footprints', to: '/notebook/visits' },
      {
        label: t('account.contributions'),
        icon: 'i-lucide-pen-line',
        to: '/notebook/contributions',
      },
    ],
    ...(isAdmin.value
      ? [
          [
            {
              label: t('account.contributors'),
              icon: 'i-lucide-users',
              to: '/moderation/contributors',
            },
          ],
        ]
      : []),
    [
      { label: t('account.settings'), icon: 'i-lucide-settings', to: '/settings' },
      { label: t('privacy.title'), icon: 'i-lucide-shield-check', to: '/privacy' },
    ],
    [{ label: t('layout.signOut'), icon: 'i-lucide-log-out', onSelect: () => signOut() }],
  ])
</script>

<template>
  <ClientOnly>
    <!--
      `modal="false"`: this is a nav menu (WAI-ARIA menu-button pattern), not
      a dialog. Nuxt UI's default `modal: true` hides the rest of the page
      from assistive tech while it's open (Reka UI's `aria-hidden`-on-siblings
      behaviour for a true modal), but the map canvas and header controls
      behind it stay focusable regardless — axe caught the mismatch as an
      `aria-hidden-focus` violation, a hidden ancestor with a reachable
      focusable descendant, which is real independent of the in-page focus
      trap that would otherwise stop a keyboard user from reaching it.
    -->
    <UDropdownMenu :items="items" :content="{ align: 'end' }" :modal="false">
      <button
        type="button"
        class="flex items-center gap-2 rounded-notebook px-2 py-1.5 text-sm text-ink-700 transition hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-night-700"
        :aria-label="t('account.menuFor', { name: currentUser?.displayName ?? '' })"
      >
        <!--
          An initial, not an avatar. There is no avatar column and adding one
          would mean an upload path, a moderation story and a licence for a
          picture of a person — a great deal of machinery to identify the one
          account the viewer is already signed in as.
        -->
        <span
          class="grid size-6 shrink-0 place-items-center rounded-full bg-bronze-200 font-display text-xs text-ink-900 dark:bg-bronze-800 dark:text-paper-100"
          aria-hidden="true"
        >
          {{ currentUser?.displayName?.charAt(0)?.toUpperCase() }}
        </span>
        <span class="hidden max-w-32 truncate sm:inline">{{ currentUser?.displayName }}</span>
      </button>

      <template #content-top>
        <!--
          Not a menu item: it is a status line, so it must not be focusable or
          activatable. Keyboard users tabbing the menu should meet only the
          things that do something.
        -->
        <div class="border-b border-paper-200 px-3 py-2 dark:border-night-700">
          <p class="truncate text-sm font-medium text-ink-900 dark:text-paper-100">
            {{ currentUser?.displayName }}
          </p>
          <p class="mt-0.5 text-xs text-ink-500 dark:text-paper-400">{{ standing }}</p>
        </div>
      </template>
    </UDropdownMenu>

    <template #fallback>
      <div class="h-9 w-9 sm:w-28" />
    </template>
  </ClientOnly>
</template>
