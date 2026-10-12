/**
 * Nuxt UI is pointed at the notebook palette rather than restyled per component,
 * so a UButton in the moderation queue and one in the contribution form cannot
 * drift apart.
 */
export default defineAppConfig({
  ui: {
    colors: {
      primary: 'oxide',
      secondary: 'bronze',
      success: 'verdigris',
      neutral: 'ink',
    },
    button: {
      defaultVariants: { size: 'md' },
    },
    /**
     * A menu taller than the screen could not be scrolled to its end. Nuxt UI's
     * content slot is `overflow-hidden` with a scrolling viewport inside it, but
     * puts no height on the content itself, so the viewport never has less room
     * than its list. Reka UI measures the room left (`--reka-dropdown-menu-
     * content-available-height`, 440px of a 500px phone, observed) and nothing
     * consumed it. Every `UDropdownMenu` in the app gets the cap.
     */
    dropdownMenu: {
      slots: { content: 'max-h-(--reka-dropdown-menu-content-available-height)' },
    },
  },
})
