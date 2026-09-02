<script setup lang="ts">
  const { loggedIn } = useSession()
  const { t } = useI18n()
</script>

<template>
  <div class="min-h-dvh bg-paper-100 dark:bg-night-900">
    <!-- See default.vue: same reason, and the header here precedes prose. -->
    <a
      href="#main"
      class="sr-only rounded-notebook focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:bg-paper-50 focus:px-3 focus:py-2 focus:text-sm focus:text-ink-900 focus:shadow-lifted dark:focus:bg-night-800 dark:focus:text-paper-100"
    >
      {{ t('layout.skipToContent') }}
    </a>

    <header class="border-b border-paper-200 dark:border-night-700">
      <div class="mx-auto flex max-w-3xl items-center gap-3 px-5 py-3">
        <UiAppMenu />

        <NuxtLink
          to="/"
          class="font-display text-lg text-ink-900 dark:text-paper-100"
          style="font-variation-settings: 'opsz' 96"
        >
          Vestigian
        </NuxtLink>
        <nav class="ml-auto flex items-center gap-1" aria-label="Main">
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
      </div>
    </header>

    <main id="main" tabindex="-1" class="mx-auto max-w-3xl px-5 py-10 focus:outline-none">
      <slot />
    </main>
  </div>
</template>
