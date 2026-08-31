export const useNoIndex = (): void => {
  useHead({ meta: [{ name: 'robots', content: 'noindex, nofollow' }] })
}
