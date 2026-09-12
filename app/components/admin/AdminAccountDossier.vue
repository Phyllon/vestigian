<script setup lang="ts">
  import { adminActionMessageKey } from '#shared/utils/authorization'
  import type { AdminDossierResponse, AdminRetractionResponse } from '#shared/types'

  /**
   * Everything one person did, and the one bulk action that applies to it.
   *
   * This is the screen a sanction is actually decided on. Whether a run of
   * thirty edits is vandalism or an enthusiast having a productive afternoon
   * is not answerable from a row in the roll, and an administrator who has to
   * reconstruct it by opening thirty site pages will reach for the block
   * button instead of reading. It is also the only honest place to offer the
   * retraction, because the counts it shows and the counts the retraction acts
   * on come from the same data.
   */
  const props = defineProps<{ userId: number }>()

  const emit = defineEmits<{ close: []; changed: [] }>()

  const { t } = useI18n()
  const router = useRouter()
  const toast = useToast()
  const stepUp = useAdminStepUp()

  // Not awaited — see the note in AdminImageQueue.vue on why `server: false`
  // and a top-level `await` together produce a hydration mismatch here.
  const {
    data,
    refresh,
    status: fetchStatus,
  } = useFetch<AdminDossierResponse>(() => `/api/admin/accounts/${props.userId}`, {
    server: false,
  })

  const account = computed(() => data.value?.account ?? null)
  const counts = computed(() => data.value?.counts ?? null)

  const heading = ref<HTMLElement | null>(null)

  /**
   * The retraction is a two-call action by design: the first call writes
   * nothing and returns the plan, so the confirmation can name real numbers
   * produced by the same function that will then act on exactly those items.
   * A count assembled separately in this component would be a second opinion
   * about an irreversible-feeling decision.
   */
  const plan = ref<AdminRetractionResponse | null>(null)
  const retractionReason = ref('')
  const isPlanning = ref(false)
  const isApplying = ref(false)

  const reportFailure = (error: unknown, title: string): void => {
    toast.add({
      title,
      description:
        (error as { data?: { message?: string } }).data?.message ?? t('admin.dossier.tryAgain'),
      color: 'error',
    })
  }

  const planRetraction = async (): Promise<void> => {
    isPlanning.value = true

    try {
      plan.value = await $fetch<AdminRetractionResponse>('/api/admin/retract', {
        method: 'POST',
        body: { userId: props.userId, apply: false, reason: retractionReason.value || '—' },
      })
    } catch (error) {
      reportFailure(error, t('admin.dossier.retractFailedTitle'))
    } finally {
      isPlanning.value = false
    }
  }

  const applyRetraction = async (): Promise<void> => {
    isApplying.value = true

    try {
      await stepUp.runPrivileged(async () => {
        const result = await $fetch<AdminRetractionResponse>('/api/admin/retract', {
          method: 'POST',
          body: {
            userId: props.userId,
            apply: true,
            reason: retractionReason.value.trim(),
          },
        })

        toast.add({
          title: t('admin.dossier.retractedToast', {
            records: result.summary.records,
            photographs: result.summary.photographs,
          }),
          description:
            (result.failed ?? 0) > 0
              ? t('admin.dossier.retractedPartly', { count: result.failed })
              : t('admin.dossier.retractedReversible'),
          color: (result.failed ?? 0) > 0 ? 'warning' : 'neutral',
        })

        plan.value = null
        retractionReason.value = ''
        await refresh()
        await refreshNuxtData(ADMIN_SYSTEM_KEY)
        emit('changed')
      })
    } catch (error) {
      reportFailure(error, t('admin.dossier.retractFailedTitle'))
    } finally {
      isApplying.value = false
    }
  }

  const seeEverythingChanged = (): void => {
    void router.replace({ query: { section: 'activity', author: props.userId } })
  }

  const canApply = computed(
    () =>
      plan.value !== null &&
      retractionReason.value.trim().length > 0 &&
      plan.value.summary.records + plan.value.summary.edits + plan.value.summary.photographs > 0,
  )

  onMounted(() => {
    // Focus follows the content: a dossier that opens without moving focus
    // leaves a keyboard user still on the list item they activated.
    heading.value?.focus()
  })
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <UButton
        size="xs"
        variant="ghost"
        color="neutral"
        icon="i-lucide-arrow-left"
        @click="emit('close')"
      >
        {{ t('admin.dossier.backToRoll') }}
      </UButton>
    </div>

    <p v-if="fetchStatus === 'pending'" class="datum">{{ t('admin.dossier.loading') }}</p>

    <template v-else-if="account && counts">
      <div class="leaf px-3 py-3 sm:px-4">
        <h2
          ref="heading"
          tabindex="-1"
          class="text-2xl text-ink-900 outline-none dark:text-paper-100"
        >
          {{ account.displayName }}
        </h2>

        <p class="datum mt-1 break-all">{{ account.email }}</p>

        <ul class="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <li class="eyebrow text-bronze-600 dark:text-bronze-300">
            {{ t(`admin.accounts.roles.${account.role}`) }}
          </li>
          <li v-if="account.bannedAt" class="eyebrow text-oxide-600 dark:text-oxide-300">
            {{ t('admin.accounts.blocked') }}
          </li>
          <li v-if="account.trustRevoked" class="eyebrow text-ink-500 dark:text-paper-400">
            {{ t('admin.accounts.standing.revoked') }}
          </li>
          <li v-if="!account.emailVerifiedAt" class="eyebrow text-ink-500 dark:text-paper-400">
            {{ t('admin.accounts.unverified') }}
          </li>
          <li v-if="account.twoFactorEnabled" class="eyebrow text-ink-500 dark:text-paper-400">
            {{ t('admin.accounts.twoFactor') }}
          </li>
        </ul>

        <dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 xl:grid-cols-4">
          <div
            v-for="entry in [
              { key: 'sitesCreated', value: counts.sitesCreated },
              { key: 'tracingsCreated', value: counts.tracingsCreated },
              { key: 'imagesUploaded', value: counts.imagesUploaded },
              { key: 'approved', value: counts.revisions.approved },
              { key: 'pending', value: counts.revisions.pending },
              { key: 'rejected', value: counts.revisions.rejected },
              { key: 'endorsements', value: counts.endorsements },
              { key: 'visits', value: counts.visits },
            ]"
            :key="entry.key"
          >
            <dt class="eyebrow text-ink-500 dark:text-paper-400">
              {{ t(`admin.dossier.counts.${entry.key}`) }}
            </dt>
            <dd class="datum text-ink-900 dark:text-paper-100">{{ entry.value }}</dd>
          </div>
        </dl>

        <p class="mt-3 text-sm text-ink-500 dark:text-paper-400">
          {{
            t('admin.dossier.joined', {
              joined: new Date(account.createdAt).toLocaleDateString(),
              seen: account.lastSeenAt
                ? new Date(account.lastSeenAt).toLocaleDateString()
                : t('admin.dossier.never'),
            })
          }}
        </p>

        <div class="mt-3">
          <UButton
            size="xs"
            variant="subtle"
            color="neutral"
            icon="i-lucide-list"
            @click="seeEverythingChanged"
          >
            {{ t('admin.dossier.seeEverythingChanged') }}
          </UButton>
        </div>
      </div>

      <!-- What they created, and what state it is currently in. -->
      <div
        v-if="data!.createdSites.length > 0 || data!.createdTracings.length > 0"
        class="leaf px-3 py-3 sm:px-4"
      >
        <h3 class="text-base text-ink-900 dark:text-paper-100">
          {{ t('admin.dossier.recordsCreated') }}
        </h3>

        <ul class="mt-2 space-y-1">
          <li
            v-for="record in [...data!.createdSites, ...data!.createdTracings]"
            :key="`${record.slug ?? 'tracing'}-${record.id}`"
            class="flex flex-wrap items-baseline gap-x-2 text-sm"
          >
            <NuxtLink
              :to="record.slug ? `/site/${record.slug}` : `/tracing/${record.id}`"
              class="text-ink-900 underline decoration-dotted underline-offset-2 dark:text-paper-100"
            >
              {{ record.title }}
            </NuxtLink>
            <span
              class="eyebrow"
              :class="
                record.status === 'approved'
                  ? 'text-verdigris-600 dark:text-verdigris-300'
                  : 'text-ink-500 dark:text-paper-400'
              "
            >
              {{ t(`admin.dossier.recordStatus.${record.status}`) }}
            </span>
          </li>
        </ul>

        <p v-if="data!.listsTruncated.sites || data!.listsTruncated.tracings" class="datum mt-2">
          {{ t('admin.dossier.truncated') }}
        </p>
      </div>

      <!--
        The bulk retraction. Separate from the block by decision — see
        `admin/retract.post.ts` — and planned before it is applied, so the
        confirmation names real numbers rather than a promise.
      -->
      <div class="leaf px-3 py-3 sm:px-4">
        <h3 class="text-base text-ink-900 dark:text-paper-100">
          {{ t('admin.dossier.retractTitle') }}
        </h3>
        <p class="mt-1 max-w-prose text-sm text-ink-500 dark:text-paper-400">
          {{ t('admin.dossier.retractExplanation') }}
        </p>

        <UFormField
          class="mt-3"
          :label="t('admin.dossier.retractReasonLabel')"
          :hint="t('admin.dossier.retractReasonHint')"
        >
          <UInput
            v-model="retractionReason"
            class="w-full"
            :placeholder="t('admin.dossier.retractReasonPlaceholder')"
          />
        </UFormField>

        <div class="mt-3 flex flex-wrap items-center gap-2">
          <UButton
            size="xs"
            variant="subtle"
            color="neutral"
            :loading="isPlanning"
            @click="planRetraction"
          >
            {{ t('admin.dossier.retractPreview') }}
          </UButton>
        </div>

        <div v-if="plan" class="mt-3 border-t border-paper-200 pt-3 dark:border-night-700">
          <p class="text-sm text-ink-900 dark:text-paper-100">
            {{
              t('admin.dossier.retractPlan', {
                records: plan.summary.records,
                edits: plan.summary.edits,
                photographs: plan.summary.photographs,
              })
            }}
          </p>

          <p v-if="plan.untouched.length > 0" class="datum mt-1">
            {{ t('admin.dossier.retractUntouched', { count: plan.untouched.length }) }}
          </p>

          <div class="mt-2 flex flex-wrap items-center gap-2">
            <UButton
              size="xs"
              color="error"
              :disabled="!canApply"
              :loading="isApplying"
              @click="applyRetraction"
            >
              {{ t('admin.dossier.retractApply') }}
            </UButton>
            <UButton size="xs" variant="ghost" color="neutral" @click="plan = null">
              {{ t('admin.accounts.cancel') }}
            </UButton>
            <p v-if="!canApply && plan.summary.records === 0" class="datum">
              {{ t('admin.dossier.retractNothingToDo') }}
            </p>
            <p v-else-if="!canApply" class="datum">
              {{ t('admin.dossier.retractReasonRequired') }}
            </p>
          </div>
        </div>
      </div>

      <!-- What has already been decided about this account, and by whom. -->
      <div v-if="data!.auditTrail.length > 0" class="leaf px-3 py-3 sm:px-4">
        <h3 class="text-base text-ink-900 dark:text-paper-100">
          {{ t('admin.dossier.decisionsTaken') }}
        </h3>

        <ul class="mt-2 space-y-1">
          <li
            v-for="entry in data!.auditTrail"
            :key="entry.id"
            class="flex flex-wrap items-baseline gap-x-2 text-sm"
          >
            <span class="text-ink-900 dark:text-paper-100">
              {{ t(adminActionMessageKey(entry.action)) }}
            </span>
            <span class="datum">
              {{ entry.actorName ?? t('admin.audit.deletedActor') }} ·
              <time :datetime="entry.createdAt">{{
                new Date(entry.createdAt).toLocaleString()
              }}</time>
            </span>
          </li>
        </ul>
      </div>
    </template>

    <AdminStepUpDialog
      v-model:open="stepUp.isDialogOpen.value"
      :confirming="stepUp.isConfirming.value"
      :error="stepUp.error.value"
      @confirm="stepUp.confirm"
      @cancel="stepUp.cancel"
    />
  </div>
</template>
