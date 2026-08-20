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
  },
})
