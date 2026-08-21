<script setup lang="ts">
  const { loggedIn, signOut } = useSession()
</script>

<template>
  <div class="min-h-dvh bg-paper-100 dark:bg-night-900">
    <header class="border-b border-paper-200 dark:border-night-700">
      <div class="mx-auto flex max-w-3xl items-center gap-3 px-5 py-3">
        <NuxtLink
          to="/"
          class="font-display text-lg text-ink-900 dark:text-paper-100"
          style="font-variation-settings: 'opsz' 96"
        >
          Vestigia
        </NuxtLink>
        <div class="ml-auto flex items-center gap-1">
          <UiThemeToggle />
          <button
            v-if="loggedIn"
            type="button"
            class="rounded-notebook px-3 py-1.5 text-sm text-ink-700 dark:text-paper-200"
            @click="signOut"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>

    <div class="mx-auto max-w-3xl px-5 py-10">
      <slot />
    </div>
  </div>
</template>
