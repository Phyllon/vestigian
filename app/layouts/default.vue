<script setup lang="ts">
  /**
   * The shell is `fixed inset-0`, not `h-dvh`.
   *
   * `dvh` is resolved once at first paint and is wrong at that moment in a
   * device-emulated viewport: the map fills a taller box than the screen, and
   * everything anchored to its bottom edge — geolocate, "Add to the atlas",
   * the legend — sits below the fold until a resize forces a recompute.
   *
   * The usual objection to pinning is mobile URL bars, which do not apply
   * here: that only bites a document that scrolls, and this one never does.
   */
  const { loggedIn, isModerator } = useSession()
  const { t } = useI18n()
</script>

<template>
  <div class="fixed inset-0 flex flex-col bg-paper-100 dark:bg-night-900">
    <!--
      First in the tab order, visible only once focused. Without it a keyboard
      or screen-reader visitor crosses the whole header on every route before
      reaching the atlas itself.
    -->
    <a
      href="#main"
      class="sr-only rounded-notebook focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:bg-paper-50 focus:px-3 focus:py-2 focus:text-sm focus:text-ink-900 focus:shadow-lifted dark:focus:bg-night-800 dark:focus:text-paper-100"
    >
      {{ t('layout.skipToMap') }}
    </a>

    <UiLanguageNotice />

    <header
      class="z-40 flex shrink-0 items-center gap-3 border-b border-paper-200 bg-paper-50 px-4 py-2 dark:border-night-700 dark:bg-night-800"
    >
      <UiAppMenu />

      <NuxtLink to="/" class="flex items-baseline gap-2">
        <!-- The wordmark is the only place Fraunces runs at full optical size. -->
        <span
          class="font-display text-xl leading-none text-ink-900 dark:text-paper-100"
          style="
            font-variation-settings:
              'opsz' 144,
              'WONK' 1;
          "
        >
          Vestigian
        </span>
        <span class="eyebrow hidden sm:inline">{{ t('layout.tagline') }}</span>
      </NuxtLink>

      <nav class="ml-auto flex items-center gap-1" aria-label="Main">
        <NuxtLink
          v-if="isModerator"
          to="/moderation"
          class="rounded-notebook px-3 py-1.5 text-sm text-ink-700 transition hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-night-700"
        >
          {{ t('layout.queue') }}
        </NuxtLink>

        <UiLanguageSwitcher />
        <UiThemeToggle />

        <AuthAccountMenu v-if="loggedIn" />
        <NuxtLink
          v-else
          to="/login"
          class="rounded-notebook px-3 py-1.5 text-sm text-ink-700 transition hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-night-700"
        >
          {{ t('layout.signIn') }}
        </NuxtLink>
      </nav>
    </header>

    <!-- `tabindex="-1"` so the skip link can move focus here, not only scroll. -->
    <main id="main" tabindex="-1" class="relative min-h-0 flex-1 focus:outline-none">
      <slot />
    </main>
  </div>
</template>
