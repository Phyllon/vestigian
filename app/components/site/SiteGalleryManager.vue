<script setup lang="ts">
  import type { SiteImage } from '#shared/types'

  const props = defineProps<{ siteId: number; images: SiteImage[] }>()
  const emit = defineEmits<{ changed: [] }>()

  const { t } = useI18n()
  const { buildUrl } = useImageUrl()
  const toast = useToast()

  const busyImageId = ref<number | null>(null)
  const editingId = ref<number | null>(null)
  const draftCaption = ref('')
  const draftAttribution = ref('')

  /**
   * Four controls repeat per photograph, so "Edit" and "Withdraw" alone read as
   * a wall of identical names. Every one of them says which picture it acts on.
   */
  const describe = (image: SiteImage, index: number): string =>
    image.caption?.trim() || t('siteGalleryManager.defaultPhotographName', { index: index + 1 })

  const move = async (image: SiteImage, direction: -1 | 1): Promise<void> => {
    const currentIndex = props.images.findIndex((candidate) => candidate.id === image.id)
    const targetIndex = currentIndex + direction
    if (targetIndex < 0 || targetIndex >= props.images.length) return

    busyImageId.value = image.id
    try {
      await $fetch(`/api/sites/${props.siteId}/images/order`, {
        method: 'POST',
        body: { imageId: image.id, targetIndex },
      })
      emit('changed')
    } catch (error) {
      toast.add({
        title: t('siteGalleryManager.reorderFailedTitle'),
        description:
          (error as { data?: { message?: string } }).data?.message ??
          t('siteGalleryManager.tryAgain'),
        color: 'error',
      })
    } finally {
      busyImageId.value = null
    }
  }

  const withdraw = async (image: SiteImage): Promise<void> => {
    busyImageId.value = image.id
    try {
      await $fetch(`/api/sites/${props.siteId}/images/${image.id}`, { method: 'DELETE' })
      toast.add({ title: t('siteGalleryManager.withdrawn'), color: 'neutral' })
      emit('changed')
    } catch (error) {
      toast.add({
        title: t('siteGalleryManager.withdrawFailedTitle'),
        description:
          (error as { data?: { message?: string } }).data?.message ??
          t('siteGalleryManager.tryAgain'),
        color: 'error',
      })
    } finally {
      busyImageId.value = null
    }
  }

  const startEditing = (image: SiteImage): void => {
    editingId.value = image.id
    draftCaption.value = image.caption ?? ''
    draftAttribution.value = image.attribution ?? ''
  }

  const saveMetadata = async (image: SiteImage): Promise<void> => {
    busyImageId.value = image.id
    try {
      await $fetch(`/api/sites/${props.siteId}/images/${image.id}`, {
        method: 'PATCH',
        body: { caption: draftCaption.value || null, attribution: draftAttribution.value || null },
      })
      editingId.value = null
      emit('changed')
    } catch (error) {
      toast.add({
        title: t('siteGalleryManager.saveFailedTitle'),
        description:
          (error as { data?: { message?: string } }).data?.message ??
          t('siteGalleryManager.tryAgain'),
        color: 'error',
      })
    } finally {
      busyImageId.value = null
    }
  }
</script>

<template>
  <section class="space-y-3">
    <div>
      <h2 class="eyebrow">{{ t('siteGalleryManager.title') }}</h2>
      <p class="mt-1 text-sm text-ink-500 dark:text-paper-400">
        {{ t('siteGalleryManager.intro') }}
      </p>
    </div>

    <ul class="space-y-2">
      <li
        v-for="(image, index) in images"
        :key="image.id"
        class="flex gap-3 rounded-notebook border border-paper-200 p-2 dark:border-night-700"
      >
        <img
          :src="buildUrl(image, 'thumb')"
          :alt="image.caption ?? ''"
          class="size-16 shrink-0 rounded-notebook object-cover"
          loading="lazy"
        />

        <div class="min-w-0 flex-1">
          <template v-if="editingId === image.id">
            <UInput
              v-model="draftCaption"
              :placeholder="t('siteGalleryManager.captionPlaceholder')"
              :aria-label="t('siteGalleryManager.captionPlaceholder')"
              size="xs"
              class="w-full"
            />
            <UInput
              v-model="draftAttribution"
              :placeholder="t('siteGalleryManager.whoTookItPlaceholder')"
              :aria-label="t('siteGalleryManager.whoTookItPlaceholder')"
              size="xs"
              class="mt-1 w-full"
            />
            <div class="mt-2 flex gap-2">
              <UButton
                size="xs"
                color="primary"
                :loading="busyImageId === image.id"
                @click="saveMetadata(image)"
              >
                {{ t('siteGalleryManager.save') }}
              </UButton>
              <UButton size="xs" variant="ghost" color="neutral" @click="editingId = null">
                {{ t('siteGalleryManager.cancel') }}
              </UButton>
            </div>
          </template>

          <template v-else>
            <p class="truncate text-sm text-ink-900 dark:text-paper-100">
              {{ image.caption || t('siteGalleryManager.noCaption') }}
            </p>
            <p class="datum truncate">
              {{ image.attribution ?? t('siteGalleryManager.creditUnknown') }} · {{ image.licence }}
            </p>

            <div class="mt-1.5 flex flex-wrap items-center gap-1">
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                icon="i-lucide-arrow-up"
                :disabled="index === 0 || busyImageId === image.id"
                :aria-label="t('siteGalleryManager.moveEarlier', { name: describe(image, index) })"
                @click="move(image, -1)"
              />
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                icon="i-lucide-arrow-down"
                :disabled="index === images.length - 1 || busyImageId === image.id"
                :aria-label="t('siteGalleryManager.moveLater', { name: describe(image, index) })"
                @click="move(image, 1)"
              />
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                :aria-label="
                  t('siteGalleryManager.editCaptionAndCredit', { name: describe(image, index) })
                "
                @click="startEditing(image)"
              >
                {{ t('siteGalleryManager.edit') }}
              </UButton>
              <UButton
                size="xs"
                variant="ghost"
                color="error"
                :loading="busyImageId === image.id"
                :aria-label="t('siteGalleryManager.withdraw', { name: describe(image, index) })"
                @click="withdraw(image)"
              >
                {{ t('siteGalleryManager.withdrawButton') }}
              </UButton>
            </div>
          </template>
        </div>
      </li>
    </ul>

    <p v-if="images.length === 0" class="datum">{{ t('siteGalleryManager.noPhotographs') }}</p>
  </section>
</template>
