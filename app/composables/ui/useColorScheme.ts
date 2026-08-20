/**
 * Colour mode with a label for the toggle. The map style is derived from the
 * same source, so the interface and the basemap can never disagree.
 */
export const useColorScheme = () => {
  const colorMode = useColorMode()

  const isDark = computed(() => colorMode.value === 'dark')

  const toggle = (): void => {
    colorMode.preference = isDark.value ? 'light' : 'dark'
  }

  const label = computed(() => (isDark.value ? 'Switch to day' : 'Switch to night'))

  return { isDark, toggle, label, preference: colorMode }
}
