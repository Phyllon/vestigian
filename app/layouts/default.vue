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
  const { loggedIn, currentUser, isModerator, signOut } = useSession()
</script>

<template>
  <div class="fixed inset-0 flex flex-col bg-paper-100 dark:bg-night-900">
    <header
      class="z-40 flex shrink-0 items-center gap-3 border-b border-paper-200 bg-paper-50 px-4 py-2 dark:border-night-700 dark:bg-night-800"
    >
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
          Vestigia
        </span>
        <span class="eyebrow hidden sm:inline">traces of antiquity</span>
      </NuxtLink>

      <div class="ml-auto flex items-center gap-1">
        <NuxtLink
          v-if="isModerator"
          to="/moderation"
          class="rounded-notebook px-3 py-1.5 text-sm text-ink-700 transition hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-night-700"
        >
          Queue
        </NuxtLink>

        <UiThemeToggle />

        <template v-if="loggedIn">
          <button
            type="button"
            class="rounded-notebook px-3 py-1.5 text-sm text-ink-700 transition hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-night-700"
            @click="signOut"
          >
            {{ currentUser?.displayName }}
          </button>
        </template>
        <NuxtLink
          v-else
          to="/login"
          class="rounded-notebook px-3 py-1.5 text-sm text-ink-700 transition hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-night-700"
        >
          Sign in
        </NuxtLink>
      </div>
    </header>

    <main class="relative min-h-0 flex-1">
      <slot />
    </main>
  </div>
</template>
