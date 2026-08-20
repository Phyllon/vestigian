<script setup lang="ts">
definePageMeta({ layout: 'reading' })
useHead({ title: 'Confirm your address' })

const route = useRoute()
const state = ref<'working' | 'done' | 'failed'>('working')
const message = ref('')

const verify = async (): Promise<void> => {
  const token = route.query.token as string | undefined
  if (!token) {
    state.value = 'failed'
    message.value = 'That link is missing its token. Open it directly from the email.'
    return
  }

  try {
    await $fetch('/api/auth/verify', { method: 'POST', body: { token } })
    state.value = 'done'
  } catch (error) {
    state.value = 'failed'
    message.value =
      (error as { data?: { message?: string } }).data?.message ?? 'That link could not be used.'
  }
}

onMounted(() => {
  void verify()
})
</script>

<template>
  <div class="leaf leaf-margin mx-auto max-w-md py-8 pr-8">
    <template v-if="state === 'working'">
      <p class="eyebrow">Checking</p>
      <h1 class="mt-2 text-2xl">One moment</h1>
    </template>

    <template v-else-if="state === 'done'">
      <p class="eyebrow">Confirmed</p>
      <h1 class="mt-2 text-2xl">Your account is ready</h1>
      <p class="mt-2 text-sm text-ink-700 dark:text-paper-200">
        Sign in and record your first site. The first two go past a moderator; after that they publish as you write them.
      </p>
      <UButton to="/login" class="mt-5" color="primary">Sign in</UButton>
    </template>

    <template v-else>
      <p class="eyebrow">Not confirmed</p>
      <h1 class="mt-2 text-2xl">That link did not work</h1>
      <p class="mt-2 text-sm text-ink-700 dark:text-paper-200">{{ message }}</p>
      <UButton to="/register" class="mt-5" variant="ghost" color="neutral">Start again</UButton>
    </template>
  </div>
</template>
