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

export default defineNuxtConfig({
  compatibilityDate: '2025-07-01',
  devtools: { enabled: !isProduction },

  modules: [
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

  css: [
    '@fontsource-variable/fraunces/index.css',
    '@fontsource/ibm-plex-sans/400.css',
    '@fontsource/ibm-plex-sans/500.css',
    '@fontsource/ibm-plex-sans/600.css',
    '@fontsource/ibm-plex-mono/400.css',
    '@fontsource/ibm-plex-mono/500.css',
    '~/assets/css/main.css',
  ],

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
      imageBaseUrl: 'http://localhost:8080',
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
        'img-src': ["'self'", 'data:', 'blob:', ...mapAssetOrigins],
        'worker-src': ["'self'", 'blob:'],
        'child-src': ["'self'", 'blob:'],
        'connect-src': ["'self'", ...mapAssetOrigins],
        'frame-src': ['https://challenges.cloudflare.com'],
        'script-src': [
          "'self'",
          "'wasm-unsafe-eval'",
          'https://challenges.cloudflare.com',
        ],
        'style-src': ["'self'", "'unsafe-inline'"],
        'font-src': ["'self'"],
      },
      crossOriginEmbedderPolicy: 'unsafe-none',
      strictTransportSecurity: isProduction
        ? { maxAge: 31536000, includeSubdomains: true }
        : false,
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
    '/api/tiles/**': {
      cache: { maxAge: 60 * 60 * 24, swr: true },
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

  typescript: {
    strict: true,
    typeCheck: false,
  },
})
