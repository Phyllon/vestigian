<script setup lang="ts">
  const { locale } = useI18n()

  useHead({
    htmlAttrs: { lang: locale },
    titleTemplate: (title?: string) => (title ? `${title} · Vestigia` : 'Vestigia'),
    link: [
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
    meta: [
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { name: 'theme-color', content: '#f2ede1' },
      {
        name: 'description',
        content:
          'Vestigia maps the traces of the ancient world — settlements, roads, fortifications and findspots, recorded by the people who visit them.',
      },
    ],
  })
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
