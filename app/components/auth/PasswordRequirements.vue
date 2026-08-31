<script setup lang="ts">
  import {
    checkPasswordRules,
    PASSWORD_MAXIMUM_LENGTH,
    PASSWORD_MINIMUM_LENGTH,
    type PasswordRuleId,
  } from '#shared/utils/password'

  /**
   * The password policy as a live checklist. Every rule is shown from the
   * first keystroke and ticks off as it is met, rather than appearing as an
   * error once the reader has already finished typing and moved on.
   *
   * `aria-live="polite"` because the list changing is the feedback — without
   * it a screen reader announces the rules once and never mentions again that
   * they have been satisfied.
   *
   * The tick and the colour are the only thing separating a met rule from an
   * unmet one on screen, and neither survives being read aloud or seen without
   * colour, so each rule carries its state in text as well.
   */
  const props = defineProps<{ password: string }>()

  const { t } = useI18n()

  const ruleLabel = (id: PasswordRuleId): string =>
    id === 'length'
      ? t('auth.passwordRequirements.rules.length', {
          min: PASSWORD_MINIMUM_LENGTH,
          max: PASSWORD_MAXIMUM_LENGTH,
        })
      : t(`auth.passwordRequirements.rules.${id}`)

  const rules = computed(() =>
    checkPasswordRules(props.password).map((rule) => ({ ...rule, label: ruleLabel(rule.id) })),
  )
</script>

<template>
  <ul class="mt-2 space-y-1" aria-live="polite">
    <li v-for="rule in rules" :key="rule.id" class="flex items-center gap-2 text-xs">
      <UIcon
        :name="rule.isMet ? 'i-lucide-check' : 'i-lucide-minus'"
        class="size-3.5 shrink-0"
        aria-hidden="true"
        :class="
          rule.isMet
            ? 'text-verdigris-600 dark:text-verdigris-300'
            : 'text-ink-300 dark:text-paper-600'
        "
      />
      <span
        :class="
          rule.isMet
            ? 'text-verdigris-700 dark:text-verdigris-200'
            : 'text-ink-500 dark:text-paper-400'
        "
      >
        {{ rule.label }}
      </span>
      <span class="sr-only">{{
        rule.isMet ? t('auth.passwordRequirements.met') : t('auth.passwordRequirements.notMet')
      }}</span>
    </li>
  </ul>
</template>
