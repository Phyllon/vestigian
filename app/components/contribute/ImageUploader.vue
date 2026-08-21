<script setup lang="ts">
  const props = defineProps<{ siteId: number }>()
  const emit = defineEmits<{ uploaded: [imageId: number] }>()

  const toast = useToast()
  const fileInput = useTemplateRef<HTMLInputElement>('fileInput')

  const selected = ref<File | null>(null)
  const previewUrl = ref<string | null>(null)
  const caption = ref('')
  const attribution = ref('')
  const licence = ref('CC-BY-SA-4.0')
  const isUploading = ref(false)

  const licenceOptions = [
    { label: 'CC BY-SA 4.0 — share alike', value: 'CC-BY-SA-4.0' },
    { label: 'CC BY 4.0 — credit required', value: 'CC-BY-4.0' },
    { label: 'CC0 — no rights reserved', value: 'CC0-1.0' },
  ]

  const choose = (event: Event): void => {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
    selected.value = file
    previewUrl.value = file ? URL.createObjectURL(file) : null
  }

  const upload = async (): Promise<void> => {
    if (!selected.value) return

    const payload = new FormData()
    payload.append('file', selected.value)
    payload.append('siteId', String(props.siteId))
    payload.append('caption', caption.value)
    payload.append('licence', licence.value)
    payload.append('attribution', attribution.value)

    isUploading.value = true
    try {
      const result = await $fetch<{ imageId: number; message: string }>(
        '/api/contributions/images',
        {
          method: 'POST',
          body: payload,
        },
      )
      toast.add({ title: result.message, color: 'success' })
      emit('uploaded', result.imageId)
      selected.value = null
      previewUrl.value = null
      caption.value = ''
      if (fileInput.value) fileInput.value.value = ''
    } catch (error) {
      toast.add({
        title: 'Upload failed',
        description:
          (error as { data?: { message?: string } }).data?.message ?? 'Try a different file.',
        color: 'error',
      })
    } finally {
      isUploading.value = false
    }
  }

  onBeforeUnmount(() => {
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  })
</script>

<template>
  <section class="space-y-3">
    <h3 class="eyebrow">Add a photograph</h3>

    <label
      class="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-notebook border border-dashed border-paper-300 px-4 py-6 text-center transition hover:border-oxide-600 dark:border-night-600"
    >
      <img
        v-if="previewUrl"
        :src="previewUrl"
        alt="Selected photograph"
        class="max-h-40 rounded-notebook object-contain"
      />
      <template v-else>
        <UIcon name="i-lucide-image-plus" class="size-6 text-ink-300" />
        <span class="text-sm text-ink-500 dark:text-paper-400">
          JPEG, PNG or WebP, up to 15 MB
        </span>
      </template>
      <input
        ref="fileInput"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        class="sr-only"
        @change="choose"
      />
    </label>

    <template v-if="selected">
      <UFormField label="Caption">
        <UInput v-model="caption" placeholder="The north gate, seen from inside" class="w-full" />
      </UFormField>

      <UFormField label="Who took it" hint="Shown as the credit">
        <UInput v-model="attribution" class="w-full" />
      </UFormField>

      <UFormField label="Licence" hint="Only upload images you may license this way">
        <USelect v-model="licence" :items="licenceOptions" class="w-full" />
      </UFormField>

      <UButton :loading="isUploading" color="primary" @click="upload">Upload photograph</UButton>
    </template>
  </section>
</template>
