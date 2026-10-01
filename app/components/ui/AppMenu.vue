<script setup lang="ts">
  /**
   * The general app menu, kept separate from the map's own floating chrome —
   * the "Key" button occupies the map's bottom-left corner, and a licence link
   * pinned there overlapped it. This one lives in the header instead, so it is
   * available everywhere without competing for space with a specific page's
   * controls, and grows in one place as more site-wide links arrive.
   */
  const { t } = useI18n()
  const config = useRuntimeConfig()

  // Several named groups, each its own array (which also draws the
  // separator between them) with a non-interactive `type: 'label'` header —
  // a plain flat list read fine with one item per row, but stopped being
  // obvious once a second and third destination arrived with nothing to say
  // which parts of the app they belonged to.
  const items = computed(() => [
    [
      { type: 'label' as const, label: t('layout.menuGroupAbout') },
      { label: t('about.menuLabel'), icon: 'i-lucide-info', to: '/about' },
    ],
    [
      { type: 'label' as const, label: t('layout.menuGroupReference') },
      // First in the group on purpose: it is the only entry that asks the
      // reader to do something rather than to read something.
      { label: t('nearby.menuLabel'), icon: 'i-lucide-camera', to: '/nearby' },
      { label: t('columns.menuLabel'), icon: 'i-lucide-scroll', to: '/columns' },
      {
        label: t('basemapSwitcher.tabulaPeutingeriana'),
        icon: 'i-lucide-map',
        to: '/tabula-peutingeriana',
      },
      { label: t('epigraphy.menuLabel'), icon: 'i-lucide-landmark', to: '/inscriptions' },
    ],
    [
      { type: 'label' as const, label: t('layout.menuGroupLegal') },
      { label: t('layout.footerLicence'), icon: 'i-lucide-scale', to: '/licence' },
      { label: t('privacy.title'), icon: 'i-lucide-shield-check', to: '/privacy' },
      { label: t('impressum.title'), icon: 'i-lucide-file-text', to: '/impressum' },
    ],
    [
      { type: 'label' as const, label: t('layout.menuGroupOffline') },
      { label: t('offlinePage.menuLabel'), icon: 'i-lucide-download', to: '/offline' },
    ],
    // A fourth group, deliberately last and its own section rather than
    // folded into "Reference": these two point off the site entirely,
    // unlike every link above them, so they get their own separator to
    // read as a clear step away from the app's own pages rather than one
    // more destination inside it. The donation link is left out of the
    // array entirely while `donateUrl` is unset, rather than rendered
    // disabled — an operator hasn't chosen a destination yet, and a dead
    // link is worse than no link.
    [
      { type: 'label' as const, label: t('layout.menuGroupSupport') },
      {
        label: t('layout.githubLink'),
        icon: 'i-lucide-github',
        to: config.public.githubUrl,
        target: '_blank',
      },
      ...(config.public.donateUrl
        ? [
            {
              label: t('layout.donateLink'),
              icon: 'i-lucide-hand-coins',
              to: config.public.donateUrl,
              target: '_blank',
            },
          ]
        : []),
    ],
  ])
</script>

<template>
  <UDropdownMenu :items="items" :content="{ align: 'start' }">
    <button
      type="button"
      class="grid size-9 place-items-center rounded-notebook text-ink-700 transition hover:bg-paper-200 dark:text-paper-200 dark:hover:bg-night-700"
      :aria-label="t('layout.menu')"
      :title="t('layout.menu')"
    >
      <UIcon name="i-lucide-menu" class="size-4" />
    </button>
  </UDropdownMenu>
</template>
