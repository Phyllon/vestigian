<script setup lang="ts">
  interface ContributorRow {
    id: number
    displayName: string
    role: string
    trustLevel: number
    approvedContributions: number
    trustRevoked: boolean
    pendingCount: number
    createdAt: string
    lastSeenAt: string | null
  }

  const { currentUser } = useSession()
  const toast = useToast()

  const search = ref('')
  const busyUserId = ref<number | null>(null)

  const { data: contributors, refresh } = await useFetch<ContributorRow[]>(
    '/api/moderation/users',
    { query: { search } },
  )

  const isAdmin = computed(() => currentUser.value?.role === 'admin')

  const roleOptions = [
    { label: 'Contributor', value: 'contributor' },
    { label: 'Moderator', value: 'moderator' },
    { label: 'Administrator', value: 'admin' },
  ]

  const describeStanding = (row: ContributorRow): string => {
    if (row.role !== 'contributor') return 'Publishes by role'
    if (row.trustRevoked) return 'Suspended — every edit queued'
    if (row.trustLevel >= 1) return 'Publishes immediately'
    return `Queued — ${Math.max(2 - row.approvedContributions, 0)} to go`
  }

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

    <div v-for="row in contributors ?? []" :key="row.id" class="leaf px-4 py-3">
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
          v-if="isAdmin && row.id !== currentUser?.id"
          :model-value="row.role"
          :items="roleOptions"
          size="xs"
          class="w-40"
          @update:model-value="(value: string) => setRole(row, value)"
        />
      </div>
    </div>

    <p v-if="(contributors ?? []).length === 0" class="datum">No contributors match that.</p>
  </div>
</template>
