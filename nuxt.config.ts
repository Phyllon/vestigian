import { fileURLToPath } from 'node:url'

const isProduction = process.env.NODE_ENV === 'production'

/**
 * Hosts the browser is allowed to talk to. Kept explicit so a new third party
 * cannot be introduced without a deliberate edit to this list.
 */
const mapAssetOrigins = [
  'https://tiles.openfreemap.org',
  'https://*.r2.dev',
  'https://*.r2.cloudflarestorage.com',
  'https://s3.amazonaws.com',
  'https://elevation-tiles-prod.s3.amazonaws.com',
]

/**
 * Every picture on the site is an imgproxy derivative, so imgproxy's origin has
 * to appear in `img-src` or the gallery is blocked outright. Declared once and
 * used both for the header and for the public runtime default, because the two
 * disagreeing is invisible until an image fails to load.
 *
 * Resolved at build time, like the CORS origin below: changing
 * NUXT_PUBLIC_IMAGE_BASE_URL at runtime without rebuilding leaves this header
 * naming the old host.
 */
const imageBaseUrl = process.env.NUXT_PUBLIC_IMAGE_BASE_URL ?? 'http://localhost:8080'
const imageOrigin = new URL(imageBaseUrl).origin

export default defineNuxtConfig({
  compatibilityDate: '2025-07-01',
  devtools: { enabled: !isProduction },

  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    '@vueuse/nuxt',
    'nuxt-auth-utils',
    'nuxt-security',
    '@nuxtjs/turnstile',
    '@nuxt/test-utils/module',
  ],

  /**
   * Composables are grouped into subdirectories (map, data, auth, ui) and Nuxt
   * only scans the top level of composables/ by default, so without this every
   * useSession()/useMapInstance() call is an undefined reference at runtime.
   */
  imports: {
    dirs: ['composables/**'],
  },

  /**
   * Per-subset sheets, not the all-subset `400.css` / `500.css` / `600.css`.
   *
   * Those declare every subset the family ships — cyrillic, cyrillic-ext,
   * greek, vietnamese — which put 758 KB of incompressible font data into the
   * build for an atlas written in English. A scan of all 61,272 approved
   * records settled which subsets earn their place: `latin-ext` carries 1,882
   * of them (İzmir, Šibenik, Ryżanówka, Hagmatāna) and stays; greek and
   * cyrillic carry 85 between them and go. Forty-five records in Arabic and
   * Hebrew already render in a fallback face, because no subset for them was
   * ever shipped — so that path was already in use before this change.
   *
   * Fraunces is left on `index.css`: `@fontsource-variable` publishes only
   * axis-scoped sheets, never subset-scoped ones, so there is nothing narrower
   * to point at. Its vietnamese face survives in the build and is never
   * fetched, which is exactly what `unicode-range` is for.
   */
  css: [
    // MapLibre positions its canvas, controls and attribution from this sheet;
    // without it the map renders but every control sits in the document flow.
    'maplibre-gl/dist/maplibre-gl.css',
    '@fontsource-variable/fraunces/index.css',
    '@fontsource/ibm-plex-sans/latin-400.css',
    '@fontsource/ibm-plex-sans/latin-ext-400.css',
    '@fontsource/ibm-plex-sans/latin-500.css',
    '@fontsource/ibm-plex-sans/latin-ext-500.css',
    '@fontsource/ibm-plex-sans/latin-600.css',
    '@fontsource/ibm-plex-sans/latin-ext-600.css',
    '@fontsource/ibm-plex-mono/latin-400.css',
    '@fontsource/ibm-plex-mono/latin-ext-400.css',
    '@fontsource/ibm-plex-mono/latin-500.css',
    '@fontsource/ibm-plex-mono/latin-ext-500.css',
    '~/assets/css/main.css',
  ],

  /**
   * `@nuxt/fonts` arrives uninvited — Nuxt UI registers it — and it will source
   * a family from Google if it decides the app has not provided one.
   *
   * With the all-subset `@fontsource` sheets it stayed quiet, because every
   * weight and subset it looked for was already declared. Narrowing those
   * imports to latin and latin-ext read to it as a gap: it went to Google's
   * catalogue for IBM Plex Sans and Mono and self-hosted **1.9 MB across 68
   * files** into `.output/public/_fonts/`, reinstating the cyrillic and greek
   * faces that had just been removed, plus bold and italic the app never uses.
   * Nothing was requested at runtime, so this never tripped the no-Google rule
   * — it simply undid the change while looking like it had worked.
   *
   * `provider: 'none'` is the module's own documented way of saying the family
   * is already provided. It also stops the two `… Fallback: Arial` metric faces
   * the module used to emit, which is a real if small loss — they size the
   * fallback to match, so text reflows less when the webfont lands. The
   * families here already declare concrete fallbacks (`--font-sans` and
   * friends in main.css) and every face is `font-display: swap`, so the cost is
   * a slight reflow rather than invisible text.
   */
  fonts: {
    families: [
      { name: 'Fraunces Variable', provider: 'none' },
      { name: 'IBM Plex Sans', provider: 'none' },
      { name: 'IBM Plex Mono', provider: 'none' },
    ],
  },

  hooks: {
    /**
     * Withdraws a Vue language-tools plugin that cannot load here.
     *
     * Nuxt 4.5 asks for `vue-router/volar/sfc-route-blocks`, which exists only
     * in vue-router 5. This project resolves vue-router 4, because `@nuxt/ui`
     * 3.3.7 pins its peer to `^4.5.0` while Nuxt depends on `^5.2.0`. Both are
     * installed; Vite dedupes the runtime to the v4 copy, so the only casualty
     * is the type plugin — `@vue/language-core` cannot require the missing
     * subpath and every `pnpm typecheck` opened with two lines of failure.
     *
     * The plugin types `<route>` custom blocks in SFCs. Every page here uses
     * `definePageMeta` and there is no `<route>` block in the codebase, so
     * withdrawing the request costs nothing.
     *
     * Registered from `ready` rather than as a `prepare:types` entry in this
     * same object, and that is the whole trick: hooks declared in `hooks` are
     * registered before modules install, so such a handler runs *first* and
     * the pages module appends the plugin again straight after. `ready` fires
     * once every module is installed, so a handler registered from inside it
     * is last in the chain.
     *
     * TODO: Delete this once `@nuxt/ui` and Nuxt agree on one vue-router major —
     * `@nuxt/ui` 4.x already accepts `^4.5.0 || ^5.0.0`, but moving there is a
     * major-version migration of every form and button in the app.
     */
    ready: (nuxt) => {
      nuxt.hook('prepare:types', ({ tsConfig }) => {
        const plugins = tsConfig.vueCompilerOptions?.plugins
        if (!Array.isArray(plugins)) return
        tsConfig.vueCompilerOptions!.plugins = plugins.filter(
          (plugin) => plugin !== 'vue-router/volar/sfc-route-blocks',
        )
      })
    },

    /**
     * Fonts are removed from the resource hints entirely.
     *
     * `@font-face` with a `unicode-range` is already lazy by design: a browser
     * fetches a face only when it has to render a character inside that range.
     * A `<link rel="preload">` or `rel="prefetch"` overrides that judgement and
     * downloads the file regardless, which is how this build came to pull all
     * 61 font files — every subset, plus a legacy `.woff` beside every `.woff2`
     * — on every single page load, 758 KB that no compression touches.
     *
     * Two of them were `preload`ed outright, so the highest-priority fonts on
     * an English-only map were Cyrillic.
     *
     * `preload` and `prefetch` are declared fields on `ResourceMeta`, and Nuxt
     * mutates this manifest through the same hook, so this is the intended
     * seam rather than a trick. It is deliberate that nothing replaces the
     * hints: the whole point is to let `unicode-range` decide.
     */
    'build:manifest': (manifest) => {
      for (const chunk of Object.values(manifest)) {
        if (chunk.resourceType !== 'font') continue
        chunk.preload = false
        chunk.prefetch = false
      }
    },
  },

  /**
   * Icons are compiled into the client bundle instead of being fetched at
   * runtime. Without this, `@nuxt/icon` resolves every `i-lucide-*` through a
   * round trip to `/api/_nuxt_icon/lucide` after hydration, so icons arrive a
   * beat after the controls they belong to and every cold page pays for it.
   * `scan` walks the source for icon names at build time, so the set stays
   * correct without a list to maintain here.
   */
  icon: {
    clientBundle: { scan: true, includeCustomCollections: true },
  },

  colorMode: {
    preference: 'system',
    fallback: 'light',
    classSuffix: '',
    storageKey: 'vestigia-color-mode',
  },

  runtimeConfig: {
    databaseUrl: '',
    redisUrl: '',
    sessionPassword: '',
    storage: {
      endpoint: '',
      bucket: '',
      accessKeyId: '',
      secretAccessKey: '',
    },
    imgproxy: {
      baseUrl: '',
      key: '',
      salt: '',
    },
    mail: {
      apiKey: '',
      from: 'Vestigia <no-reply@vestigia.example>',
    },
    public: {
      siteUrl: 'http://localhost:3000',
      imageBaseUrl,
      basemap: {
        /** 'openfreemap' for zero-setup development, 'pmtiles' for production. */
        provider: 'openfreemap',
        pmtilesUrl: '',
        terrainUrl: 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png',
      },
    },
  },

  turnstile: {
    siteKey: process.env.NUXT_PUBLIC_TURNSTILE_SITE_KEY ?? '',
    addValidateEndpoint: false,
  },

  security: {
    headers: {
      contentSecurityPolicy: {
        'default-src': ["'self'"],
        'img-src': ["'self'", 'data:', 'blob:', imageOrigin, ...mapAssetOrigins],
        'worker-src': ["'self'", 'blob:'],
        'child-src': ["'self'", 'blob:'],
        'connect-src': ["'self'", ...mapAssetOrigins],
        'frame-src': ['https://challenges.cloudflare.com'],
        /**
         * Nuxt stamps a per-request nonce on the inline scripts that carry the
         * runtime config and the pre-paint colour-mode switch. Without the
         * matching 'nonce-{{nonce}}' token here the browser refuses those
         * scripts and the client app never mounts at all.
         */
        'script-src': [
          "'self'",
          "'nonce-{{nonce}}'",
          "'wasm-unsafe-eval'",
          'https://challenges.cloudflare.com',
        ],
        'style-src': ["'self'", "'unsafe-inline'"],
        'font-src': ["'self'"],
        /**
         * On in production, off in development, and the development half is
         * not laziness. This directive rewrites every http:// subresource to
         * https:// *before* the img-src check runs, so the imgproxy origin
         * allowlisted above is not the origin the browser ends up asking for.
         * The whole dev stack — imgproxy, MinIO, mailpit — speaks plain http
         * and has no certificate to offer, so the upgraded request could not
         * succeed even if the policy let it through.
         */
        'upgrade-insecure-requests': isProduction,
      },
      crossOriginEmbedderPolicy: 'unsafe-none',
      strictTransportSecurity: isProduction ? { maxAge: 31536000, includeSubdomains: true } : false,
    },
    rateLimiter: false,
    corsHandler: {
      origin: process.env.NUXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    },
  },

  nitro: {
    compressPublicAssets: { gzip: true, brotli: true },
    storage: {
      tiles: isProduction
        ? { driver: 'redis', url: process.env.NUXT_REDIS_URL }
        : { driver: 'memory' },
    },
  },

  routeRules: {
    /**
     * Headers only, deliberately no `cache`. Nitro's route cache serialises the
     * response body, so a binary tile comes back out of it as
     * `{"type":"Buffer","data":[...]}` — eight times the size, under a
     * vector-tile content type, and MapLibre renders nothing while every status
     * code still says 200. It only shows on the *second* request for a tile,
     * which makes it look like a rendering bug rather than a caching one.
     *
     * Tiles are already cached in Valkey by the handler itself, keyed on the
     * data version, which is the mechanism the whole design rests on.
     */
    '/api/tiles/**': {
      headers: { 'cache-control': 'public, max-age=3600, stale-while-revalidate=86400' },
    },
    '/api/sites/**': {
      headers: { 'cache-control': 'public, max-age=60' },
    },
  },

  vite: {
    optimizeDeps: { include: ['maplibre-gl', 'pmtiles'] },
  },

  alias: {
    '~~/server': fileURLToPath(new URL('./server', import.meta.url)),
  },

  /**
   * These reach every generated tsconfig. The root tsconfig.json only holds
   * project references now, and compiler options placed there would be ignored.
   */
  typescript: {
    strict: true,
    typeCheck: false,
    tsConfig: {
      compilerOptions: {
        noUncheckedIndexedAccess: true,
        noImplicitOverride: true,
        verbatimModuleSyntax: true,
      },
    },
  },

  eslint: {
    config: {
      // Formatting is Prettier's job; ESLint keeps to correctness and to the
      // conventions in CLAUDE.md that a formatter cannot express.
      stylistic: false,
    },
  },
})
