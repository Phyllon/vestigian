<script setup lang="ts">
  import { checkPasswordRules } from '#shared/utils/password'

  /**
   * The password policy as a live checklist. Every rule is shown from the
   * first keystroke and ticks off as it is met, rather than appearing as an
   * error once the reader has already finished typing and moved on.
   *
   * `aria-live="polite"` because the list changing is the feedback — without
   * it a screen reader announces the rules once and never mentions again that
   * they have been satisfied.
   */
  const props = defineProps<{ password: string }>()

  const rules = computed(() => checkPasswordRules(props.password))
</script>

<template>
  <ul class="mt-2 space-y-1" aria-live="polite">
    <li v-for="rule in rules" :key="rule.id" class="flex items-center gap-2 text-xs">
      <UIcon
        :name="rule.isMet ? 'i-lucide-check' : 'i-lucide-minus'"
        class="size-3.5 shrink-0"
        :class="
          rule.isMet ? 'text-verdigris-600 dark:text-verdigris-300' : 'text-ink-300 dark:text-paper-600'
        "
      />
      <span
        :class="
          rule.isMet ? 'text-verdigris-700 dark:text-verdigris-200' : 'text-ink-500 dark:text-paper-400'
        "
      >
        {{ rule.label }}
      </span>
    </li>
  </ul>
</template>
