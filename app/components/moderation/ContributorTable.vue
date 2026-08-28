<script setup lang="ts">
  import { checkRoleChange, evaluateTrust, TRUST_THRESHOLD } from '#shared/utils/authorization'
  import type { TrustEvaluation, UserRole } from '#shared/types'

  interface ContributorRow {
    id: number
    displayName: string
    role: UserRole
    approvedContributions: number
    trustRevoked: boolean
    pendingCount: number
    createdAt: string
    lastSeenAt: string | null
  }

  interface ContributorList {
    adminCount: number
    contributors: ContributorRow[]
  }

  const { currentUser } = useSession()
  const toast = useToast()

  const search = ref('')
  const busyUserId = ref<number | null>(null)

  /**
   * Suspension asks for a reason before it happens; restoring does not.
   *
   * Two steps rather than one because the endpoint now emails the contributor:
   * the reason is the only part of a suspension they can act on, and a control
   * that fires on the first click would send that mail with nothing in it.
   */
  const suspendingUserId = ref<number | null>(null)
  const suspensionReason = ref('')

  const { data, refresh } = await useFetch<ContributorList>('/api/moderation/users', {
    query: { search },
  })

  const contributors = computed(() => data.value?.contributors ?? [])

  const roleOptions = [
    { label: 'Contributor', value: 'contributor' },
    { label: 'Moderator', value: 'moderator' },
    { label: 'Administrator', value: 'admin' },
  ]

  /**
   * One phrase per reason `evaluateTrust` can give, so the branch order is the
   * server's rather than something a reader has to check against it by eye.
   */
  const STANDING_BY_REASON: Record<TrustEvaluation['reason'], (row: ContributorRow) => string> = {
    moderator: () => 'Publishes by role',
    revoked: () => 'Suspended — every edit queued',
    earned: () => 'Publishes immediately',
    probation: (row) =>
      `Queued — ${Math.max(TRUST_THRESHOLD - row.approvedContributions, 0)} to go`,
  }

  const describeStanding = (row: ContributorRow): string =>
    STANDING_BY_REASON[evaluateTrust(row).reason](row)

  /**
   * Mirrors `checkRoleChange` rather than restating a subset of it, so the
   * select is absent in exactly the cases the endpoint would refuse — including
   * the last admin, which this component used to offer and then 403 on.
   */
  const mayChangeRole = (row: ContributorRow): boolean =>
    currentUser.value !== null &&
    checkRoleChange({
      actor: currentUser.value,
      targetUserId: row.id,
      targetCurrentRole: row.role,
      // The demotion is the case that can be refused; asking about it is what
      // reveals whether this row is the last admin.
      nextRole: 'contributor',
      adminCount: data.value?.adminCount ?? 0,
    }).allowed

  const startSuspension = (row: ContributorRow): void => {
    suspendingUserId.value = row.id
    suspensionReason.value = ''
  }

  const cancelSuspension = (): void => {
    suspendingUserId.value = null
  }

  interface TrustChange {
    row: ContributorRow
    revoked: boolean
    reason?: string
  }

  const setTrust = async (change: TrustChange): Promise<void> => {
    busyUserId.value = change.row.id
    try {
      await $fetch('/api/moderation/trust', {
        method: 'POST',
        body: {
          userId: change.row.id,
          revoked: change.revoked,
          reason: change.reason?.trim() || undefined,
        },
      })
      toast.add({
        title: change.revoked ? 'Automatic publishing suspended.' : 'Trust restored.',
        description: `${change.row.displayName} has been told by email.`,
        color: change.revoked ? 'neutral' : 'success',
      })
      suspendingUserId.value = null
      await refresh()
    } catch (error) {
      toast.add({
        title: 'Could not change trust',
        description: (error as { data?: { message?: string } }).data?.message ?? 'Try again.',
        color: 'error',
      })
    } finally {
      busyUserId.value = null
    }
  }

  const setRole = async (row: ContributorRow, role: string): Promise<void> => {
    busyUserId.value = row.id
    try {
      await $fetch('/api/moderation/role', { method: 'POST', body: { userId: row.id, role } })
      toast.add({ title: `${row.displayName} is now a ${role}.`, color: 'success' })
      await refresh()
    } catch (error) {
      toast.add({
        title: 'Could not change role',
        description: (error as { data?: { message?: string } }).data?.message ?? 'Try again.',
        color: 'error',
      })
    } finally {
      busyUserId.value = null
    }
  }
</script>

<template>
  <div class="space-y-4">
    <UInput
      v-model="search"
      placeholder="Find a contributor"
      aria-label="Find a contributor"
      icon="i-lucide-search"
      class="w-full max-w-xs"
    />

    <!--
      A list of people, not a stack of panels: the count and the position in it
      are announced, which is what makes a long roll navigable by keyboard.
    -->
    <ul class="space-y-4">
      <li v-for="row in contributors" :key="row.id" class="leaf px-4 py-3">
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 class="text-base text-ink-900 dark:text-paper-100">{{ row.displayName }}</h2>
          <span
            v-if="row.role !== 'contributor'"
            class="eyebrow text-oxide-600 dark:text-oxide-300"
          >
            {{ row.role }}
          </span>
          <span class="datum ml-auto">
            {{ row.approvedContributions }} accepted
            <template v-if="row.pendingCount > 0"> · {{ row.pendingCount }} waiting</template>
          </span>
        </div>

        <p class="mt-0.5 text-sm text-ink-500 dark:text-paper-400">
          {{ describeStanding(row) }}
        </p>

        <div class="mt-3 flex flex-wrap items-center gap-2">
          <!-- Every control here repeats per row, so each names its person. -->
          <UButton
            v-if="row.role === 'contributor' && row.trustRevoked"
            size="xs"
            color="success"
            :loading="busyUserId === row.id"
            :aria-label="`Restore trust for ${row.displayName}`"
            @click="setTrust({ row, revoked: false })"
          >
            Restore trust
          </UButton>

          <UButton
            v-else-if="row.role === 'contributor' && suspendingUserId !== row.id"
            size="xs"
            variant="ghost"
            color="error"
            :aria-label="`Suspend publishing for ${row.displayName}`"
            @click="startSuspension(row)"
          >
            Suspend publishing
          </UButton>

          <USelect
            v-if="mayChangeRole(row) && suspendingUserId !== row.id"
            :model-value="row.role"
            :items="roleOptions"
            :aria-label="`Role for ${row.displayName}`"
            size="xs"
            class="w-40"
            @update:model-value="(value: string) => setRole(row, value)"
          />
        </div>

        <div v-if="suspendingUserId === row.id" class="mt-3">
          <UFormField
            :label="`Why is ${row.displayName} being suspended?`"
            hint="Emailed to them, verbatim"
          >
            <UInput
              v-model="suspensionReason"
              placeholder="Three edits removed sourced text without saying why."
              class="w-full"
            />
          </UFormField>

          <div class="mt-2 flex flex-wrap items-center gap-2">
            <UButton
              size="xs"
              color="error"
              :loading="busyUserId === row.id"
              @click="setTrust({ row, revoked: true, reason: suspensionReason })"
            >
              Suspend publishing
            </UButton>
            <UButton size="xs" variant="ghost" color="neutral" @click="cancelSuspension">
              Cancel
            </UButton>
            <p class="datum">Their accepted contributions are untouched.</p>
          </div>
        </div>
      </li>
    </ul>

    <p v-if="contributors.length === 0" class="datum">No contributors match that.</p>
  </div>
</template>
