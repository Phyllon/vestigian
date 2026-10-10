import type { Map as MapLibreMap, Popup } from 'maplibre-gl'
import type { SpotContext, SpotSourceId } from '#shared/types'
import { REFERENCE_SOURCES } from '#shared/utils/reference-sources'
import {
  coordinateDecimalsForZoom,
  creditsForContext,
  describeExtentPresence,
  distanceFromFix,
  elevationStepForZoom,
  formatCoordinates,
  formatElevation,
  formatSpotDistance,
  snapCoordinate,
} from '#shared/utils/spot'
import { formatYear } from '../limes/useLimes'
import type { FrontierTranslate } from '../limes/useLimes'
import { escapeHtmlForPopup } from './popupHtml'

/**
 * The "about this spot" block under a reference mark's own text in its info
 * box: where it is, how far from the reader, and who the record comes from —
 * always shown, none of it needing the network — and, behind a disclosure, the
 * town, country, elevation and Roman-state extent that `GET /api/spot` works
 * out from the coordinate.
 *
 * Collapsed by default and fetched on opening: most taps on a mark want the
 * mark, not its surroundings, and a phone screen has little room for five more
 * lines.
 */

const link = (url: string, text: string): string =>
  `<a href="${escapeHtmlForPopup(url)}" target="_blank" rel="noopener noreferrer">${escapeHtmlForPopup(text)}</a>`

/** A licence name is one unit — `CC BY 4.0` must not break across two lines. */
const unbroken = (text: string): string => escapeHtmlForPopup(text.replaceAll(' ', '\u00a0'))

const LABEL_CLASS = 'eyebrow'
const NOTE_CLASS = 'text-xs text-ink-500 dark:text-paper-400'

export interface SpotFactsHtmlRequest {
  /** `[lon, lat]`, as the tile delivered it. */
  position: [number, number]
  /** The map zoom when tapped — it decides how many decimals the coordinate honestly carries. */
  zoom: number
  sourceId: SpotSourceId
  /** Metres from the reader, or `null` when there is no usable fix. */
  distanceMetres: number | null
  locale: string
  t: FrontierTranslate
}

/** Static rows plus the empty disclosure the derived rows are written into. */
export const buildSpotFactsHtml = (request: SpotFactsHtmlRequest): string => {
  const { position, zoom, sourceId, distanceMetres, locale, t } = request
  const source = REFERENCE_SOURCES[sourceId]
  const coordinates = formatCoordinates(position[0], position[1], coordinateDecimalsForZoom(zoom))

  const rows = [`<p class="font-mono text-xs">${escapeHtmlForPopup(coordinates)}</p>`]
  if (distanceMetres !== null) {
    rows.push(
      `<p>${escapeHtmlForPopup(t('spotFacts.distance', { distance: formatSpotDistance(distanceMetres, locale) }))}</p>`,
    )
  }
  rows.push(
    `<details data-spot-details class="mt-1">` +
      `<summary class="cursor-pointer text-ink-500 dark:text-paper-400">${escapeHtmlForPopup(t('spotFacts.summary'))}</summary>` +
      `<div data-spot-body aria-live="polite" class="mt-1 space-y-1"></div>` +
      `</details>`,
    `<p class="${NOTE_CLASS}"><span class="${LABEL_CLASS}">${escapeHtmlForPopup(t('spotFacts.sourceLabel'))}</span> ${link(source.url, source.name)} · ${unbroken(source.licence)}</p>`,
  )

  return `<div data-spot-facts class="mt-3 space-y-1 border-t border-paper-300 pt-2 text-[0.8rem] leading-snug dark:border-night-600">${rows.join('')}</div>`
}

export interface SpotBodyHtmlRequest {
  context: SpotContext
  zoom: number
  latitude: number
  /** The year the period scrubber is on, or `null` when it is off. */
  periodYear: number | null
  locale: string
  t: FrontierTranslate
  countryName: (code: string | null) => string | null
}

const buildPlaceRow = (request: SpotBodyHtmlRequest): string | null => {
  const { context, locale, t, countryName } = request
  const country = countryName(context.countryCode)
  const town = context.nearestTown
  if (town && country) {
    return t('spotFacts.nearTown', {
      town: town.name,
      distance: formatSpotDistance(town.distanceMetres, locale),
      country,
    })
  }
  if (town) {
    return t('spotFacts.nearTownOnly', {
      town: town.name,
      distance: formatSpotDistance(town.distanceMetres, locale),
    })
  }
  if (country) return t('spotFacts.countryOnly', { country })
  return null
}

const buildExtentRow = (request: SpotBodyHtmlRequest): string | null => {
  const { context, periodYear, t } = request
  if (context.extentSpans === null) return null

  const presence = describeExtentPresence(context.extentSpans, periodYear)
  switch (presence.state) {
    case 'inside':
      return t('spotFacts.extentInside', { year: formatYear(presence.year, t) })
    case 'outside':
      return t('spotFacts.extentOutside', { year: formatYear(presence.year, t) })
    case 'spans':
      return t('spotFacts.extentSpans', {
        spans: presence.spans
          .map(([from, to]) =>
            t('limesFormat.yearRange', { from: formatYear(from, t), to: formatYear(to, t) }),
          )
          .join(', '),
      })
    case 'never':
      return t('spotFacts.extentNever')
  }
}

/** The disclosure's contents: one line each for place, elevation and extent, then who they came from. */
export const buildSpotBodyHtml = (request: SpotBodyHtmlRequest): string => {
  const { context, zoom, latitude, locale, t } = request

  const sentences = [
    buildPlaceRow(request),
    context.elevationMetres === null
      ? null
      : t('spotFacts.elevation', {
          metres: formatElevation(
            context.elevationMetres,
            elevationStepForZoom(zoom, latitude),
            locale,
          ),
        }),
    buildExtentRow(request),
  ].filter((sentence): sentence is string => sentence !== null)

  const paragraphs = sentences.map((sentence) => `<p>${escapeHtmlForPopup(sentence)}</p>`)

  const credits = creditsForContext(context)
    .map((credit) =>
      credit.licence
        ? `${link(credit.url, credit.name)} (${unbroken(credit.licence)})`
        : link(credit.url, credit.name),
    )
    .join(' · ')
  if (sentences.length > 0 && credits) {
    paragraphs.push(
      `<p class="${NOTE_CLASS}"><span class="${LABEL_CLASS}">${escapeHtmlForPopup(t('spotFacts.derivedLabel'))}</span> ${credits}</p>`,
    )
  }

  return paragraphs.join('')
}

/**
 * How far below the top of the map a popup has to stay. The search field and
 * the control buttons float over the map there, and MapLibre only keeps a popup
 * inside the map's own box — so an opened disclosure grew the popup upward
 * under them, hiding its title.
 */
const POPUP_TOP_CLEARANCE_PX = 72

/** Nudges the map down, once, if the popup has ended up under the controls. */
const keepPopupClearOfControls = (map: MapLibreMap, popup: Popup): void => {
  requestAnimationFrame(() => {
    const popupTop = popup.getElement().getBoundingClientRect().top
    const mapTop = map.getContainer().getBoundingClientRect().top
    const shortfall = mapTop + POPUP_TOP_CLEARANCE_PX - popupTop
    if (shortfall > 0) map.panBy([0, -shortfall], { duration: 200 })
  })
}

export interface SpotFactsBinding {
  map: MapLibreMap
  position: [number, number]
  sourceId: SpotSourceId
}

export interface PreparedSpotFacts {
  /** Markup to append to the popup's own. */
  html: string
  /** Wire the disclosure up once the popup is in the DOM. */
  bind: (popup: Popup) => void
}

/**
 * `useOverlayPopup` is the one caller: every reference overlay opens its
 * popup through it, so asking for facts is one extra argument on each, not a
 * second code path per overlay.
 */
export const useSpotFacts = () => {
  const { t, locale } = useI18n()
  const { countryName } = useCountryName()
  const { periodYear } = useBasemapStyle()
  const deviceFix = useDeviceFix()

  const prepareSpotFacts = (binding: SpotFactsBinding): PreparedSpotFacts => {
    const { map, position, sourceId } = binding
    const zoom = map.getZoom()
    const spot = { lon: position[0], lat: position[1] }

    const html = buildSpotFactsHtml({
      position,
      zoom,
      sourceId,
      distanceMetres: distanceFromFix(spot, deviceFix.value, Date.now()),
      locale: locale.value,
      t,
    })

    const bind = (popup: Popup): void => {
      const root = popup.getElement()
      const details = root.querySelector<HTMLDetailsElement>('[data-spot-details]')
      const body = root.querySelector<HTMLElement>('[data-spot-body]')
      if (!details || !body) return

      // The block itself adds three lines; a mark near the top may now sit under the controls.
      keepPopupClearOfControls(map, popup)

      let state: 'idle' | 'loading' | 'done' = 'idle'

      details.addEventListener('toggle', async () => {
        if (!details.open || state !== 'idle') return
        state = 'loading'
        body.textContent = t('spotFacts.loading')
        keepPopupClearOfControls(map, popup)

        try {
          // The same grain the server caches at, so the answer is a cache hit
          // for any reader who tapped within eleven metres of this one.
          const context = await $fetch<SpotContext>('/api/spot', {
            query: { lon: snapCoordinate(spot.lon), lat: snapCoordinate(spot.lat) },
          })
          // The popup may have been closed while the answer was on its way.
          if (!details.isConnected) return
          body.innerHTML = buildSpotBodyHtml({
            context,
            zoom,
            latitude: spot.lat,
            periodYear: periodYear.value,
            locale: locale.value,
            t,
            countryName,
          })
          state = 'done'
          keepPopupClearOfControls(map, popup)
        } catch {
          if (!details.isConnected) return
          body.textContent = t('spotFacts.unavailable')
          // Closing and reopening the disclosure tries again.
          state = 'idle'
        }
      })
    }

    return { html, bind }
  }

  return { prepareSpotFacts }
}
