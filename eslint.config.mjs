// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'
import prettier from 'eslint-config-prettier'
import vueA11y from 'eslint-plugin-vuejs-accessibility'
// Named, not default: the default export is typed as the generic `ESLint.Plugin`,
// whose `configs` is optional and a legacy/flat union `withNuxt` rejects.
import { configs as sonarjsConfigs } from 'eslint-plugin-sonarjs'
import security from 'eslint-plugin-security'

/**
 * ESLint covers correctness and the conventions in CLAUDE.md that a formatter
 * cannot express. Everything about how code *looks* is Prettier's, and
 * eslint-config-prettier is applied last so the two never argue.
 *
 * The Nuxt-generated base knows the project's auto-imports, which is why
 * useHead and useSession do not read as undefined globals here.
 *
 * `eslint-plugin-sonarjs` runs the SonarQube "bug"/"code smell" rule set
 * (cognitive complexity, duplicated logic, dead code) locally — this project
 * has no hosted SonarQube instance to talk to, so this is the offline
 * equivalent rather than a client for one.
 *
 * `eslint-plugin-security` is the SAST layer that runs on every commit and
 * push (see `scripts/security/scan-sast.sh` for the heavier opengrep pass,
 * which is dataflow-aware and covers what a regex-based ESLint rule cannot).
 * `detect-object-injection` is off, not `warn`: run once at `recommended` it
 * produced 162 warnings, including five inside `shared/utils/authorization.ts`
 * itself — every `ROLE_RANK[role]` lookup by a typed enum key reads as the
 * same sink as `obj[req.query.key]`, and the rule cannot tell the two apart.
 * A warning nobody can act on file-by-file is exactly the backlog this
 * project's tooling is supposed to not have (see CLAUDE.md's "it passes;
 * treat any output as a regression"). TypeScript's own indexed-access typing
 * already rejects an unknown key at the call sites that matter here.
 */
export default withNuxt(
  ...vueA11y.configs['flat/recommended'],
  sonarjsConfigs.recommended,
  security.configs.recommended,

  {
    name: 'vestigian/security',
    rules: {
      'security/detect-object-injection': 'off',
    },
  },

  {
    name: 'vestigian/conventions',
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

      // This project has exactly one deferred-work marker (nuxt.config.ts,
      // blocked on `@nuxt/ui` and Nuxt agreeing on a vue-router major) and it
      // carries its own paragraph of why it's deferred rather than done —
      // the "forgotten task" this rule guards against. A SonarQube project
      // would track that as a linked issue instead of flagging the comment
      // forever; there is no ticket tracker here to link to, so the comment
      // is where it lives.
      'sonarjs/todo-tag': 'off',

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },

  {
    name: 'vestigian/vue',
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

      // The plugin's own default demands *both* a nested control and a
      // for/id pair on every label — stricter than WCAG, which only asks for
      // one working association. `some` is what eslint-plugin-jsx-a11y
      // defaults to for the same rule, and matches how labels are actually
      // built here: RegisterForm's honeypot and ImageUploader's dropzone nest
      // their control, MapSearchField pairs a sr-only label with `for`/`id`
      // because the control sits beside icons the label cannot wrap.
      'vuejs-accessibility/label-has-for': ['error', { required: { some: ['nesting', 'id'] } }],
    },
  },

  {
    // The import pipeline, the maintenance scripts and the migration runner
    // report progress on stdout — that is their interface, not a debugging
    // leftover. They are one-shot processes that exit, so they have no logger
    // and nothing would collect it if they did. The Bunny bouncer is the same
    // shape (a long-running poller outside Nitro, stdout is what Alloy
    // discovers), just not under scripts/ or written in TypeScript.
    name: 'vestigian/scripts',
    files: ['scripts/**/*.ts', 'server/database/migrate.ts', 'docker/security/bunny-bouncer/*.mjs'],
    rules: {
      'no-console': 'off',

      // Every path here comes from an operator's own CLI argument or a fixed
      // output directory this repo already controls (`.import/`, snapshot
      // folders) — one-shot, locally run, never reachable from a request.
      // The rule earns its keep on `server/**`, where it currently has
      // nothing to flag; that absence is the point, not a gap to widen here.
      'security/detect-non-literal-fs-filename': 'off',
    },
  },

  {
    name: 'vestigian/tests',
    files: ['**/__test__/**/*.ts'],
    rules: {
      'max-params': 'off',
      '@typescript-eslint/no-explicit-any': 'off',

      // Test fixtures read known files by a relative path built in the test
      // itself, and `buildMilitaryFeatureTypePattern()`
      // (shared/utils/limes.test.ts) compiles a fixed gazetteer, never
      // attacker input — both trip the rule's static-argument heuristic with
      // nothing for it to actually warn about.
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-non-literal-regexp': 'off',
    },
  },

  {
    // Every credential under e2e/ is a fixture for an @e2e.local account
    // (`E2E_PASSWORD` in helpers/accounts.ts, or a deliberately-wrong literal
    // asserting a 401/403), reset between runs by global-setup/teardown —
    // never a real secret. `Math.random()` here jitters fixture coordinates
    // so parallel test runs don't collide on the same site position, which
    // has nothing to do with the crypto-strength concern the rule exists for.
    name: 'vestigian/e2e',
    files: ['e2e/**/*.ts'],
    rules: {
      'sonarjs/no-hardcoded-passwords': 'off',
      'sonarjs/pseudo-random': 'off',

      // Every dynamic RegExp here is built from a slug the test itself just
      // fetched from the app's own API moments earlier, never from anything
      // an attacker could shape.
      'security/detect-non-literal-regexp': 'off',
    },
  },

  {
    name: 'vestigian/ignores',
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
