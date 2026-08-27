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

  const setTrust = async (row: ContributorRow, revoked: boolean): Promise<void> => {
    busyUserId.value = row.id
    try {
      await $fetch('/api/moderation/trust', {
        method: 'POST',
        body: { userId: row.id, revoked },
      })
      toast.add({
        title: revoked ? 'Automatic publishing suspended.' : 'Trust restored.',
        color: revoked ? 'neutral' : 'success',
      })
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
      icon="i-lucide-search"
      class="w-full max-w-xs"
    />

    <div v-for="row in contributors" :key="row.id" class="leaf px-4 py-3">
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 class="text-base text-ink-900 dark:text-paper-100">{{ row.displayName }}</h3>
        <span v-if="row.role !== 'contributor'" class="eyebrow text-oxide-600 dark:text-oxide-300">
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
        <UButton
          v-if="row.role === 'contributor'"
          size="xs"
          :variant="row.trustRevoked ? 'solid' : 'ghost'"
          :color="row.trustRevoked ? 'success' : 'error'"
          :loading="busyUserId === row.id"
          @click="setTrust(row, !row.trustRevoked)"
        >
          {{ row.trustRevoked ? 'Restore trust' : 'Suspend publishing' }}
        </UButton>

        <USelect
          v-if="mayChangeRole(row)"
          :model-value="row.role"
          :items="roleOptions"
          size="xs"
          class="w-40"
          @update:model-value="(value: string) => setRole(row, value)"
        />
      </div>
    </div>

    <p v-if="contributors.length === 0" class="datum">No contributors match that.</p>
  </div>
</template>
