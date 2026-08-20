/**
 * One breakpoint, not five. The layout has exactly two states: a sheet that
 * rises over the map on handhelds, and a fixed panel beside it on wide screens.
 */
export const useBreakpoint = () => {
  const isWide = useMediaQuery('(min-width: 900px)')
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

  return { isWide, isCompact: computed(() => !isWide.value), prefersReducedMotion }
}
