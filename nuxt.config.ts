import { fileURLToPath } from 'node:url'

const isProduction = process.env.NODE_ENV === 'production'

/**
 * Hosts the browser is allowed to talk to. Kept explicit so a new third party
 * cannot be introduced without a deliberate edit to this list.
 */
const mapAssetOrigins = [
  'https://tiles.openfreemap.org',
  // Bunny: `*.b-cdn.net` is the pull zone the browser fetches from, and
  // `storage.bunnycdn.com` is Edge Storage where the PMTiles extract lives.
  // These replaced the Cloudflare R2 hosts when the edge moved into the EU —
  // the CDN and the object store both terminate TLS, and doing that under EU
  // law rather than the CLOUD Act is the whole point of the move.
  'https://*.b-cdn.net',
  'https://storage.bunnycdn.com',
  // Mapterhorn: hillshade under the Barrington sheet. Terrarium-encoded,
  // Copernicus GLO-30 based — replaced Mapzen's tiles on AWS Open Data, which
  // is why an unset-env fresh clone still falls back to a real host here too.
  'https://tiles.mapterhorn.com',
  // DARE's tile server, needed only until the mirror is populated and
  // NUXT_PUBLIC_BASEMAP_ANTIQUITY_DARE_URL points at the pull zone. It stays in
  // the list because the unset-env fallback is what makes a fresh clone work.
  // The other antiquity sheet needs no entry: it is served from this origin.
  'https://dh.gu.se',
  // EOX's Sentinel-2 cloudless tile server (Vienna, Austria), the satellite
  // view's live source until NUXT_PUBLIC_BASEMAP_SATELLITE_URL points at a
  // mirror — same "unset-env fallback" reasoning as dh.gu.se above.
  'https://tiles.maps.eox.at',
]

/**
 * The Tabula Peutingeriana viewer's one origin. Kept separate from
 * `mapAssetOrigins` above rather than folded in: nothing here is a MapLibre
 * basemap — the manuscript is schematic, not georeferenced, and is shown in
 * its own IIIF deep-zoom viewer (`/tabula-peutingeriana`), never draped under
 * real coordinates. René Voorburg (Netherlands) hosts an IIIF Image API v3
 * service for the manuscript scan, moved to Codeberg "as a commitment to
 * European software independence" in his own words — the same person this
 * project already has a courtesy-contact relationship with for image
 * mirroring (see CLAUDE.md's import-pipeline section).
 */
const iiifAssetOrigins = ['https://iiif.omnesviae.org']

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
    '@nuxt/test-utils/module',
    '@nuxtjs/i18n',
    '@vite-pwa/nuxt',
  ],

  /**
   * `no_prefix`: locale lives in a cookie, not the URL. Slugs never change on
   * edit and the sitemap points at them (see CLAUDE.md's governance section);
   * prefixing every route with `/fr`, `/de`, … would double the URL surface
   * six times over for a change that is about interface text and enrichment
   * content, not localized routing, with no `hreflang` investment to back it.
   *
   * That "no hreflang investment" is deliberate, not an oversight to fix
   * later: `hreflang` alternates require one crawlable URL per language
   * variant, and there is exactly one URL per page here regardless of
   * locale — tags pointing every variant at the same address would either
   * be ignored by Google or actively misread as duplicates. The two real,
   * cheap mitigations instead: `app.vue`'s `htmlAttrs.lang` already reflects
   * `useI18n().locale`, which under SSR resolves from this same cookie
   * before render, so the one indexable variant's `lang` is correct; and
   * `server/middleware/content-language.ts` sets a `Content-Language`
   * response header from the same cookie, so it's explicit — not merely
   * implied by `lang` — which language a crawler is seeing, since Google
   * will only ever index whichever locale resolves for an anonymous crawl
   * (the default, `en`, absent a cookie).
   */
  i18n: {
    strategy: 'no_prefix',
    defaultLocale: 'en',
    langDir: 'locales',
    locales: [
      { code: 'en', name: 'English', file: 'en.json' },
      { code: 'fr', name: 'Français', file: 'fr.json' },
      { code: 'es', name: 'Español', file: 'es.json' },
      { code: 'de', name: 'Deutsch', file: 'de.json' },
      { code: 'it', name: 'Italiano', file: 'it.json' },
      { code: 'nl', name: 'Nederlands', file: 'nl.json' },
    ],
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'vestigian-locale',
      redirectOn: 'no prefix',
    },
  },

  /**
   * Composables are grouped into subdirectories (map, data, auth, ui) and Nuxt
   * only scans the top level of composables/ by default, so without this every
   * useSession()/useMapInstance() call is an undefined reference at runtime.
   */
  imports: {
    dirs: ['composables/**'],
  },

  vue: {
    compilerOptions: {
      /**
       * Two tags the compiler would otherwise try to resolve as components.
       *
       * `<altcha-widget>` is a web component from the `altcha` package, not a
       * Vue component. Without this the compiler treats it as an unresolved
       * component and warns on every render of the signup form.
       *
       * `<search>` is a native element — the landmark wrapper around the map's
       * search field — but Vue's list of known HTML tags predates it and has
       * not caught up, so it was compiled as a component, resolved to nothing
       * and left the built page hydrating over markup the client did not
       * produce. Visible only as "Hydration completed but contains mismatches"
       * in the production console.
       */
      isCustomElement: (tag) => tag.startsWith('altcha-') || tag === 'search',
    },
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
    storageKey: 'vestigian-color-mode',
  },

  runtimeConfig: {
    /**
     * Session lifetime, stated explicitly because the default is not what it
     * looks like.
     *
     * With `maxAge` unset, nuxt-auth-utils falls through to h3's defaults and the
     * iron seal is created with `ttl: 0` — which does not mean "expires
     * immediately", it means **never expires** — while the cookie itself is
     * written with no `Max-Age` at all. A captured `nuxt-session` cookie was
     * therefore valid indefinitely, and the session is stateless so nothing can
     * revoke it.
     *
     * A week is the trade: long enough that contributors are not signed out
     * mid-edit, short enough that a leaked cookie stops working. Note this is
     * about the cookie's lifetime only — `requireModerator`/`requireAdmin`
     * already re-read role and trust from Postgres, so a demotion still takes
     * effect on the next request regardless of how old the session is.
     */
    session: {
      maxAge: 60 * 60 * 24 * 7,
      cookie: {
        sameSite: 'lax',
      },
    },

    /**
     * Set only where a CDN we control sits in front and overwrites `x-real-ip`.
     * Off by default, so a direct-to-origin deployment cannot be talked into
     * believing a spoofed header. See `resolveForwardedIdentifier` — and note
     * that setting this true without an origin firewall is worse than leaving
     * it false, because it makes every rate limit forgeable by anyone who finds
     * the origin address.
     */
    behindTrustedProxy: false,
    /**
     * HMAC secret for the ALTCHA signup challenge. Server-side only, and the
     * whole of what the challenge needs — no container, no datastore, no third
     * party. Empty means signup refuses with a 503 that names this variable.
     */
    altchaSecret: '',
    /**
     * Telemetry. All three are server-side: the browser never speaks to the
     * observability stack, and `connect-src` in the CSP below would refuse it
     * if it tried.
     *
     * An empty `otlpEndpoint` disables tracing outright rather than retrying
     * against nothing — the collector is optional infrastructure, and the app
     * must start and serve without it exactly as it does without LibreTranslate.
     */
    telemetry: {
      serviceName: 'vestigian',
      otlpEndpoint: '',
      /** `debug` | `info` | `warn` | `error`. */
      logLevel: 'info',
      /**
       * Fraction of tile requests that get a trace. Tiles are the hot path and
       * would otherwise be almost all of the trace volume while being the least
       * interesting thing in it. Everything else is sampled at 100%.
       */
      tileSampleRatio: 0.05,
    },
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
    /**
     * Lettermint (Amsterdam), not Resend: the addresses and display names in
     * transactional mail are the last personal data that was still leaving the
     * EU after the CDN and object store moved. `apiKey` is a Lettermint
     * project token.
     *
     * `devInboxUrl` is Mailpit's HTTP API, which the dev stack already runs.
     * It is read only when no API key is set and only in development — see
     * `server/utils/mail.ts` — so a production box can never post mail to it.
     */
    mail: {
      apiKey: '',
      from: 'Vestigian <no-reply@vestigian.example>',
      devInboxUrl: 'http://127.0.0.1:8025',
    },
    /**
     * Self-hosted LibreTranslate. Server-side only, deliberately: the URL is
     * private config, the browser never talks to it, and an empty value simply
     * turns translation off rather than breaking anything.
     */
    translate: {
      url: '',
      target: 'en',
    },
    public: {
      siteUrl: 'http://localhost:3000',
      imageBaseUrl,
      basemap: {
        /** 'openfreemap' for zero-setup development, 'pmtiles' for production. */
        provider: 'openfreemap',
        pmtilesUrl: '',
        /**
         * Elevation for the hillshade under the Barrington sheet. Empty means
         * "use Mapterhorn's tiles" — the default lives in `useBasemapStyle`
         * beside the DARE one, so that an env file which sets this to nothing
         * gets the working default rather than a blank sheet.
         */
        terrainUrl: '',
        /**
         * The mirrored DARE pyramid. Empty means "ask Gothenburg's own server",
         * which is right for development and wrong for production — see
         * `pnpm import:basemap` and the note in `.env.example`.
         */
        antiquityDareUrl: '',
        /**
         * The mirrored Sentinel-2 cloudless pyramid. Empty means "ask EOX's own
         * tile server directly" — right for development, wrong for production
         * once traffic is real; see `pnpm import:satellite-tiles`.
         */
        satelliteUrl: '',
        /**
         * The antiquity atlas is served by this application from its own
         * PostGIS, so this is a path rather than a third-party origin.
         */
        atlasTilesUrl: '/api/tiles/antiquity',
        /**
         * The frontier, from the same PostGIS. Its own endpoint rather than two
         * more layers on the atlas tile: most readers never switch it on, and
         * folding it in would charge them for it on every tile.
         */
        limesTilesUrl: '/api/tiles/limes',
        /**
         * Label glyphs ship with the app rather than being fetched from a font
         * server, for the same reason `@fontsource` is used for the interface:
         * reading the map should tell no third party that you did. Same-origin,
         * so `default-src 'self'` already covers it.
         */
        glyphsUrl: '/fonts/{fontstack}/{range}.pbf',
      },
      /**
       * Off by default, deliberately — not a "no setup yet" default like the
       * URLs above. `pnpm import:tabula-peutingeriana` populates
       * `tabula_peutingeriana_places`/`_roads` regardless (the import itself
       * touches nothing a visitor sees), but the source data
       * (`omnesviae.org/data/omnesviae.json`) states no licence anywhere, so
       * `server/api/tabula-peutingeriana/network.geojson.get.ts` 404s and the
       * basemap switcher's toggle is hidden until an operator sets this to
       * `true` — after confirming reuse is fine with René Voorburg, the same
       * courtesy this project already extends to Åhlfeldt (DARE) and EOX. See
       * CLAUDE.md's "The Tabula Peutingeriana network" section.
       */
      tabulaPeutingerianaEnabled: false,
    },
  },

  security: {
    headers: {
      contentSecurityPolicy: {
        'default-src': ["'self'"],
        'img-src': [
          "'self'",
          'data:',
          'blob:',
          imageOrigin,
          ...mapAssetOrigins,
          ...iiifAssetOrigins,
        ],
        'worker-src': ["'self'", 'blob:'],
        'child-src': ["'self'", 'blob:'],
        'connect-src': [
          "'self'",
          ...mapAssetOrigins,
          ...iiifAssetOrigins,
          ...(isProduction ? [] : ['https://cdn.jsdelivr.net']),
        ],
        /**
         * Nuxt stamps a per-request nonce on the inline scripts that carry the
         * runtime config and the pre-paint colour-mode switch. Without the
         * matching 'nonce-{{nonce}}' token here the browser refuses those
         * scripts and the client app never mounts at all.
         *
         * `cdn.jsdelivr.net` is added in development only, for the Scalar
         * OpenAPI UI's own bundle (`nitro.openAPI.ui.scalar` below) — the same
         * third-party runtime request self-hosted fonts, self-hosted glyphs
         * and ALTCHA-over-Turnstile exist to avoid, accepted here only because
         * it never ships to production: `/_scalar` itself 404s in production
         * regardless of this policy (`nitro.openAPI.production` below), so
         * loosening the CSP for it only ever matters against a developer's own
         * local traffic.
         */
        'script-src': [
          "'self'",
          "'nonce-{{nonce}}'",
          "'wasm-unsafe-eval'",
          ...(isProduction ? [] : ['https://cdn.jsdelivr.net']),
        ],
        'style-src': [
          "'self'",
          "'unsafe-inline'",
          ...(isProduction ? [] : ['https://cdn.jsdelivr.net']),
        ],
        'font-src': ["'self'", ...(isProduction ? [] : ['https://cdn.jsdelivr.net'])],
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
    /**
     * `nuxt-security`'s own default for a `multipart/form-data` request is
     * 8 MB — well under the 15 MB (`MAX_UPLOAD_BYTES`,
     * `server/utils/uploads.ts`) this app actually advertises to a
     * contributor. Left at the default, a 10 MB phone photograph never
     * reached `server/api/contributions/images.post.ts` at all: this
     * middleware ran first and answered a bare 413, never the friendly
     * "Images must be under 15 MB" message `describeRejection` exists to
     * show. The two numbers must be read together — raising one without the
     * other just moves which layer silently wins.
     */
    requestSizeLimiter: {
      maxUploadFileRequestInBytes: 15_500_000,
    },
    /**
     * Off, and deliberately: `nuxt-security`'s default policy runs every GET
     * query and POST body (`methods: ['GET', 'POST']` — PATCH and DELETE were
     * never covered even while this was on, which was itself a gap) through
     * the `xss` package's `FilterXSS`, then rejects the request outright if
     * filtering changed a single byte. `FilterXSS` HTML-escapes any `<` it
     * cannot parse as a real tag it recognises, so "the wall is <2m tall" in a
     * site summary or a visit note is escaped to "&lt;2m tall" and refused —
     * identically to `<script>`. The comparison cannot tell them apart, which
     * is the library working as designed for a body assumed to *be* HTML, not
     * a defect to configure around: no whitelist or option here changes that
     * an ordinary `<` in free text is indistinguishable from an attack to a
     * filter that only asks "did anything change".
     *
     * The reason it is safe to turn off rather than merely worked around: this
     * app has no `v-html` anywhere (`grep -rn v-html app/` returns nothing) so
     * every value a Vue template renders is escaped by `{{ }}` regardless of
     * this middleware. The two places user text reaches a non-Vue-escaped
     * output — HTML mail (`server/utils/mail-template.ts`'s `escapeHtml`) and
     * the GPX field kit (`server/utils/gpx.ts`'s `escapeXml`) — already encode
     * for their own context explicitly, and both are unit-tested for it. Input
     * filtering that cannot distinguish "<2m" from "<script>" was defending
     * output paths that were already defended correctly; turning it off traded
     * a blunt, redundant check for the free-text fields the app is full of
     * (summaries, notes, bios, edit summaries) actually working.
     */
    xssValidator: false,
    corsHandler: {
      origin: process.env.NUXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    },
  },

  /**
   * The offline field notebook: a hand-written Service Worker, not
   * `generateSW`'s declarative routing.
   *
   * `generateSW` covers "cache what the app requests as it requests it,"
   * which is the wrong shape for this feature — an explicit, user-triggered
   * bulk download of a bounded area, with progress reporting and a named,
   * permanently-retained cache per area, is application logic no declarative
   * routing config expresses. `injectManifest` gives that custom logic a real
   * service worker file (`service-worker/sw.ts`) while still getting
   * Workbox's precaching of the built app shell and its well-tested update
   * lifecycle — the part actually worth not hand-rolling, per the reasoning
   * that put Nuxt UI ahead of custom form controls elsewhere in this project.
   *
   * `manifest: false`: `public/manifest.webmanifest` is hand-written and
   * already linked from `app.vue`, built by `pnpm icons:build`. Nothing here
   * duplicates or replaces it.
   */
  pwa: {
    strategies: 'injectManifest',
    // Not `'service-worker'`: @vite-pwa/nuxt resolves `srcDir` against
    // `nuxt.options.srcDir` (Nuxt 4's `app/`), not the project root, and this
    // repo keeps everything that is not Nuxt-scanned code — `server/`,
    // `shared/`, and now this — at the top level to match `scripts/` and
    // `tsconfig.scripts.json`'s own reasoning: it is not part of the Nuxt app
    // and should not read as though it were.
    srcDir: fileURLToPath(new URL('./service-worker', import.meta.url)),
    filename: 'sw.ts',
    manifest: false,
    injectManifest: {
      // The four tile-route families are runtime-cached by the service
      // worker's own fetch handler, not precached — there is no fixed set of
      // tiles to list ahead of time, and precaching would download nothing
      // useful while inflating the app-shell manifest.
      globPatterns: ['**/*.{js,css,html}', 'fonts/**/*.woff2'],
      globIgnores: ['**/node_modules/**/*'],
    },
    registerType: 'autoUpdate',
    devOptions: {
      // Off in `nuxt dev`: Vite's dev server rewrites and hot-reloads modules
      // in ways a service worker's cache-first strategy actively fights. The
      // offline feature is exercised against the production build, the same
      // as everything else in `e2e/`.
      enabled: false,
    },
  },

  nitro: {
    compressPublicAssets: { gzip: true, brotli: true },
    storage: {
      tiles: isProduction
        ? { driver: 'redis', url: process.env.NUXT_REDIS_URL }
        : { driver: 'memory' },
    },
    experimental: { openAPI: true },
    /**
     * Dev only. The spec was served in production too until it was pointed
     * out that an unauthenticated, machine-readable map of every route,
     * parameter and response shape is worth withholding from the public
     * internet even though each endpoint underneath still enforces its own
     * auth guard and rate limit independently — the spec is a convenience for
     * this project's own development, not a public contract, and
     * `/api/data/sites.geojson` remains the intentionally public, documented
     * feed regardless.
     *
     * Scalar is on in development only; Swagger stays off regardless — one UI
     * is enough, and Scalar's is the nicer of the two. Nitro's `/_scalar` and
     * `/_swagger` routes both load their renderer from `cdn.jsdelivr.net` — a
     * runtime request to a third party, the exact thing self-hosted fonts,
     * self-hosted glyphs and ALTCHA-over-Turnstile exist to avoid — which is
     * why this stays off in production and why the CSP above only allowlists
     * that host for `!isProduction`. Left at Nitro's default, the CSP here
     * would have refused the request silently, the same way the missing nonce
     * token once did.
     */
    openAPI: {
      /**
       * Not `/api/openapi.json` — that path is `server/api/openapi.json.get.ts`,
       * a normal route that fetches this one and merges in the parameter and
       * request-body schemas derived from each route's zod validator. That
       * route also 404s outright in production, on `import.meta.dev`, as a
       * second guard independent of this flag.
       *
       * `defineRouteMeta` is a build-time macro: its argument is parsed as an
       * AST and only object/array literals of literals survive
       * (`nitropack/dist/rollup/index.mjs`'s `astToObject`). A call like
       * `paramsFromSchema(querySchema, 'query')` — or even a reference to an
       * imported constant — returns `undefined` and is silently dropped, which
       * is not something a build error would ever surface. `tags`, `summary`
       * and `description` survive because they are written as literals; the
       * schema-shaped fields cannot be, so they are computed at request time
       * instead, in a route with no such restriction.
       */
      route: '/_nitro-base-openapi.json',
      production: isProduction ? false : 'runtime',
      meta: {
        title: 'Vestigian API',
        description:
          'Site, tracing, tile, moderation and frontier endpoints. Data is CC BY-SA / CC0; see /api/data/sites.geojson for the bulk feed.',
      },
      ui: { scalar: !isProduction, swagger: false },
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
    optimizeDeps: { include: ['maplibre-gl', 'pmtiles', 'openseadragon'] },
    /**
     * Vite refuses requests whose Host header it does not recognise, which in
     * development means Alloy's metrics scrape — it reaches the dev server as
     * `host.docker.internal:3000` and got a 403 that reads like an application
     * error rather than a dev-server guard.
     *
     * Development only: production serves the built output with no Vite in the
     * process at all, and Alloy reaches the app as an ordinary compose service.
     */
    server: {
      allowedHosts: ['host.docker.internal'],
    },
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
