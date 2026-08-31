/**
 * Colour mode toggle. The map style is derived from the same source, so the
 * interface and the basemap can never disagree. The toggle's label is not
 * returned here — it is locale text, and a composable has no guarantee of
 * running inside an i18n-aware setup context, so `ThemeToggle.vue` builds it
 * from `isDark` with `t()` directly.
 */
export const useColorScheme = () => {
  const colorMode = useColorMode()

  const isDark = computed(() => colorMode.value === 'dark')

  const toggle = (): void => {
    colorMode.preference = isDark.value ? 'light' : 'dark'
  }

  return { isDark, toggle, preference: colorMode }
}
