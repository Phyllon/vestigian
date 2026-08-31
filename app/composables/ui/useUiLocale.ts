export interface LocaleOption {
  code: string
  name: string
}

/** Falls back to the code itself when a locale carries no display name. */
export const resolveLocaleName = (available: LocaleOption[], code: string): string =>
  available.find((entry) => entry.code === code)?.name ?? code

/**
 * The interface language, kept beside `useColorScheme` in the same folder
 * since a locale choice is the same kind of small, persistent preference —
 * except colour mode leans entirely on `@nuxt/ui`'s built-in module, and
 * there is no equivalent module handling persistence for locale, so the
 * cookie read/write lives here.
 *
 * Named `useUiLocale`, not `useLocale`: `@nuxtjs/i18n` auto-imports its own
 * `useLocale()`, and Nuxt's import scanner resolves that one first — a
 * same-named composable here silently called the module's version instead of
 * this file's, with no error until `nuxt typecheck` disagreed about the
 * return type.
 */
export const useUiLocale = () => {
  const { locale, locales, setLocale: setI18nLocale } = useI18n()

  const availableLocales = computed<LocaleOption[]>(() =>
    (locales.value as { code: string; name?: string }[]).map((entry) => ({
      code: entry.code,
      name: entry.name ?? entry.code,
    })),
  )

  const currentName = computed(() => resolveLocaleName(availableLocales.value, locale.value))

  const setLocale = async (code: string): Promise<void> => {
    await setI18nLocale(code as Parameters<typeof setI18nLocale>[0])
  }

  return { locale, availableLocales, currentName, setLocale }
}
