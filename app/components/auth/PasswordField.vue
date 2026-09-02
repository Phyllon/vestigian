<script setup lang="ts">
  /**
   * A password input with a reveal toggle. A thin composition over `UInput`
   * rather than a hand-rolled control: the field, its validation state and its
   * styling all still come from Nuxt UI, and only the trailing button is ours.
   *
   * The button stays in the tab order. It is a real control — someone typing a
   * long passphrase on a phone keyboard is exactly who needs it — and skipping
   * it with `tabindex="-1"` would hide it from the people most likely to want
   * it. `type="button"` is explicit because a bare button inside a form
   * submits it, which would post a half-filled registration on first click.
   *
   * `id` is optional and forwarded to `UInput` rather than left to Nuxt UI's
   * own `useId()`. See the comment above the field ids in `settings.vue`: on
   * a page whose header mounts `ClientOnly`-deferred widgets, that
   * auto-generated id can drift from the `for`/`aria-describedby` values its
   * own `UFormField` renders, and axe catches the result as an unlabelled
   * control. A caller inside such a layout should pass an explicit `id`.
   */
  defineProps<{ autocomplete?: string; id?: string }>()

  const { t } = useI18n()

  const model = defineModel<string>({ default: '' })

  const isRevealed = ref(false)

  const toggleReveal = (): void => {
    isRevealed.value = !isRevealed.value
  }
</script>

<template>
  <UInput
    :id="id"
    v-model="model"
    :type="isRevealed ? 'text' : 'password'"
    :autocomplete="autocomplete"
    class="w-full"
  >
    <template #trailing>
      <UButton
        type="button"
        color="neutral"
        variant="link"
        size="sm"
        :icon="isRevealed ? 'i-lucide-eye-off' : 'i-lucide-eye'"
        :aria-label="
          isRevealed ? t('auth.passwordField.hidePassword') : t('auth.passwordField.showPassword')
        "
        :aria-pressed="isRevealed"
        class="-me-1"
        @click="toggleReveal"
      />
    </template>
  </UInput>
</template>
