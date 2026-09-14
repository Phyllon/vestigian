/**
 * eslint-plugin-security ships no types, and `@types/eslint-plugin-security`
 * is no answer: it depends on `@types/eslint`, whose `Linter.Config` is not
 * assignable to the one ESLint 10 bundles, so installing it reproduces the very
 * mismatch this declaration avoids. Only `configs.recommended` is read, by
 * eslint.config.mjs, so only that is described beyond the plugin shape.
 */
declare module 'eslint-plugin-security' {
  import type { ESLint, Linter } from 'eslint'

  const plugin: ESLint.Plugin & { configs: { recommended: Linter.Config } }
  export default plugin
}
