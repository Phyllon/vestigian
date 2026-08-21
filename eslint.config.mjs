// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'
import prettier from 'eslint-config-prettier'

/**
 * ESLint covers correctness and the conventions in CLAUDE.md that a formatter
 * cannot express. Everything about how code *looks* is Prettier's, and
 * eslint-config-prettier is applied last so the two never argue.
 *
 * The Nuxt-generated base knows the project's auto-imports, which is why
 * useHead and useSession do not read as undefined globals here.
 */
export default withNuxt(
  {
    name: 'vestigia/conventions',
    rules: {
      // "Arrow functions only. No function declarations."
      'func-style': ['error', 'expression', { allowArrowFunctions: true }],

      // "Define a named interface when a function takes more than two
      // parameters. Do not add a third positional parameter."
      'max-params': ['error', 3],

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'object-shorthand': ['error', 'always'],
      'prefer-const': 'error',

      // Deliberately not enabled: @typescript-eslint/consistent-type-imports.
      // It needs type-aware linting, which across five generated tsconfigs
      // costs far more than the rule is worth — the codebase already uses
      // `import type` throughout.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },

  {
    name: 'vestigia/vue',
    files: ['**/*.vue'],
    rules: {
      // "Vue SFC order: <script setup> first, <template> second."
      'vue/block-order': ['error', { order: ['script', 'template'] }],

      // "No <style> blocks — Tailwind inline only."
      'vue/no-restricted-block': ['error', 'style'],

      // Descriptions are contributed text. Rendering them as HTML would turn
      // every edit into a stored-XSS opportunity.
      'vue/no-v-html': 'error',

      'vue/component-name-in-template-casing': ['error', 'PascalCase'],
      'vue/define-macros-order': ['error', { order: ['defineProps', 'defineEmits'] }],
      'vue/no-unused-refs': 'error',
      'vue/prefer-separate-static-class': 'error',
      'vue/attributes-order': 'warn',
      'vue/no-useless-v-bind': 'error',
      'vue/require-explicit-emits': 'error',
    },
  },

  {
    // The import pipeline and maintenance scripts report progress on stdout —
    // that is their interface, not a debugging leftover.
    name: 'vestigia/scripts',
    files: ['scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  {
    name: 'vestigia/tests',
    files: ['**/__test__/**/*.ts'],
    rules: {
      'max-params': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  {
    name: 'vestigia/ignores',
    ignores: [
      '.nuxt/**',
      '.output/**',
      '.import/**',
      'db_dumb/**',
      'image-archive/**',
      'coverage/**',
      'dist/**',
      'server/database/migrations/**',
    ],
  },

  prettier,
)
