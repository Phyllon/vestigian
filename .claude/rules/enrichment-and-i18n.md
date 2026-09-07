---
paths:
  - 'server/utils/enrichment.ts'
  - 'server/utils/enrichment-sources.ts'
  - 'server/utils/translate.ts'
  - 'server/api/sites/[id]/enrichment.ts'
  - 'i18n/**'
  - 'scripts/i18n/**'
---

## Enrichment — borrowed prose, and how sure we are of it

`/api/sites/:id/enrichment` returns a Wikipedia extract, or null. **Null is an
ordinary answer.** A server proxy behind Valkey, not a browser fetch: the CSP
allows no Wikimedia origin, one fetch serves every visitor, and Wikidata's
search endpoint refused eight calls spaced 800 ms apart.

Nothing is written to Postgres. Storage would be trivial (~7 MB); the objection
is that the text is CC BY-SA and third-party, so a stored copy makes this a
republisher rather than a linker, and nothing would ever invalidate it. Valkey
keeps a hit 7 days and a refusal 1 day; the browser keeps its own 7 days.

**A concordance is a lead, not a guarantee.** Across 30 sites with a Wikidata
id, coordinates agreed to a median of 53 m — but p90 was 1,050 m and the worst
35.8 km, a Q-id pointing at a modern municipality. A match therefore needs the
identifier **and** a coordinate within 250 m **and** a place type that does not
contradict `category`. That last check is what stops "Castellum Aardenburg"
being described by the article for the _town_ of Aardenburg, and rejects the
Pleiades join resolving to "Aardenburg (Samian Ware Discovery Site)" 1.2 km off.

**Six Wikipedias**: `en`, then `nl`, `de`, `es`, `it`, `fr`. Over 60 random
sites with a Q-id, English alone reached 77%, the set 87%; of 52 matches English
served 46, German 4, Dutch 1, Spanish 1. On Dutch ground it matters far more —
one slice of 14 went from 2 matches to 10.

**Translation is a service we run.** `libretranslate` in both compose files,
internal network only, driven by the `translate` package via
`NUXT_TRANSLATE_URL` — self-hosted so reading a site tells no third party
anything. `LT_LOAD_ONLY` pins the six languages (**1.2 GB of models**, plus an
872 MB image; es→en alone is 302 MB, de 158 MB each way, nl/fr ~80 MB). Without
it every available model loads. `LT_UPDATE_MODELS` is required or a language
added to `LT_LOAD_ONLY` is silently ignored on an existing volume.

Translation happens server-side, so it runs once per site into the same Valkey
entry. **It fails open, and that is load-bearing**: with the container stopped,
Dutch articles still arrive labelled `nl` in under 600 ms. The app deliberately
does not `depends_on` it — a cold volume takes minutes and no deploy should wait
on an optional nicety.

Nothing is passed off as English that is not: translated text says
"Machine-translated from Dutch", untranslated says "In Dutch", and the paragraph
carries `lang` either way. A machine translation of a CC BY-SA article is still
that article's derivative.

Remaining losses are not fixable by loosening the threshold — no article in any
of the six, genuinely too far, or no coordinate to check.

**`/api/sites/:id/enrichment` now takes `lang`** (one of the six enrichment
languages, `shared/types`' `ENRICHMENT_LANGUAGES`), defaulting to
`translate.target` when omitted. The Valkey cache key is
`` `enrich:v3:${siteId}:${lang}` `` — language-scoped, unlike the earlier
`v3:${siteId}` key, because without it whichever visitor happened to warm the
cache first would silently serve their translation to every other language's
request for the same site. `loadWikidataFacts` also takes the target language
and tries that Wikipedia edition first, before falling back to the fixed
`en, nl, de, es, it, fr` order — a native article in the language actually
being read beats a machine translation of the English one, which is the same
gap the sampling above already measured.

## i18n

Six languages — French, Spanish, English, German, Italian, Dutch — via
`@nuxtjs/i18n`, `strategy: 'no_prefix'`. The locale lives in a cookie
(`vestigian-locale`), not the URL: slugs never change on edit and the sitemap
points at them, and prefixing every route with `/fr`, `/de`, … would double
the URL surface six times over with no `hreflang` investment to back it, for a
change that is about interface text and enrichment content, not localized
routing.

`i18n/locales/en.json` is the central message catalogue this file used to call
a prerequisite for adding locales at all — namespaced by the same folder
grouping as `app/components/` (`map.basemapSwitcher.*`, `auth.login.*`, …), so
a key's home is obvious from its name. The other five are bootstrapped from it
by `pnpm i18n:translate` (`scripts/i18n/translate-locales.ts`) against the
self-hosted LibreTranslate instance — once, offline, not per request the way
enrichment translation is: UI chrome does not change per visitor, so there is
no reason to pay a translation call on every page load for it. The script never
sends an ICU placeholder (`{id}`) to the translator at all — it splits each
string around its placeholders and translates only the surrounding text,
splicing the placeholder back in verbatim, because the first version tried
substituting a token (`⟦0⟧`) instead and the real LibreTranslate instance
silently dropped it rather than preserving it: "Select revision {id}" came
back as "Selecteer revisie:" with nothing about the response looking wrong
until something tried to interpolate into it. It also writes progress after
every key rather than once at the end of a language — the first run hung on
`nl`'s very first call with no timeout and no partial file to show for it —
is resumable (a key already translated to something other than the English
source is left alone), and reports any key LibreTranslate returned nothing
useful for so a human knows what still needs a manual pass. The five output
files are static, checked-in
JSON, editable afterward like any translation.

**`pnpm i18n:translate` preflights the LibreTranslate endpoint** (`/languages`,
resolved against the origin of `NUXT_TRANSLATE_URL` — that variable already
points at `/translate`, so naively appending `/languages` to it hits a 404 that
looks identical to a dead service) with its own 5s timeout before starting.
Without it a dead arbiter (below) hangs the whole run instead of failing fast
with a message that says what to do.

**LibreTranslate's gunicorn arbiter has been observed dropping to zero
workers, twice, and `init: true` alone does not fix it.** Its own entrypoint
runs gunicorn with `--max-requests 250`; the burst of small requests
`translate-locales.ts` fires hits that ceiling on both `LT_THREADS` workers
within about a minute of each other, and gunicorn is supposed to spawn a
replacement the instant it retires one ("Autorestarting worker after current
request") — confirmed by container logs, twice, that it sometimes does not.
The container keeps listening and the healthcheck can still pass on stale
luck, so every request queues forever with nothing to accept it. `init: true`
(tini as PID 1, the standard fix for a dockerized process losing signals) is
kept in both compose files as correct hygiene but was tried first and did
**not** stop this from recurring, which is what proves the arbiter itself is
wedging — plausibly in a `child_exit` hook tied to the Prometheus multiprocess
cleanup the entrypoint sets up — rather than a signal-reaping problem. The
actual fix is `autoheal` (`willfarrell/autoheal`, both compose files):
`libretranslate` carries `labels: { autoheal: 'true' }` and a healthcheck cut
from `retries: 30` to `3`, so `unhealthy` is reached in well under a minute
instead of five, and the sidecar restarts the container itself — nothing in
this repo can fix gunicorn's own arbiter, so restarting around it is the
whole mitigation. `docker restart vestigian-dev-libretranslate-1` is still the
manual fallback if autoheal hasn't caught up yet, and the preflight check
above is what turns a still-wedged arbiter into a clear message instead of a
silent hang in the meantime.

**Wordmarks and domain vocabulary are frozen — the translator never sees
them.** `FROZEN_KEYS`/`FROZEN_KEY_PREFIXES` in `translate-locales.ts` list
keys that are skipped entirely, because the resumability rule below cannot
tell a deliberately-English wordmark from an untranslated string: it
re-translates anything still equal to the English source, so every run
re-mangled the same names. Left running, it produced `Wikidonnées` for
Wikidata, `OuvrirStreetMap` for OpenStreetMap, `Plejaden`/`Pléiades`/
`Pleiadi` for Pleiades, `Aracide` for Arachne, `iDAI.gazetteter` for
iDAI.gazetteer, `Tabula Peu*i*ngeriana`, and it truncated `Tafeln I–LXIV`
to `Tafeln I`. The second category is this atlas's own vocabulary, which a
general model reads without any archaeology in scope: `Settlement` came back
as `Abrechnung` and `Règlement` (the financial sense both times),
`Legionary fortress` as `Fortaleza legislativa`, `Watchtower` as `La Tour de
Garde` (the magazine), `Findspot` as `Zoeken` ("search") and `Trova il
posto`, and `English` as `Changements climatiques`. 75 values across the five
catalogues were corrected by hand when this was found.

**The space before a placeholder was being eaten, in every locale.** The
script splits a string around its placeholders and translates the segments
between them, so "Scene {number}" goes to LibreTranslate as "Scene " — and
LibreTranslate returns a trimmed string, so the reply joined back as
"Szenerie{number}". Every locale carried it, and it was read as a
translation-quality problem rather than a mechanical one for a while;
"of {total}" arriving as "von{total}" is what made it obvious.
`restoreSurroundingSpace` puts back whatever whitespace the source segment
began or ended with, and trims whatever the translator added of its own
accord. The fix is in the splice, not in the catalogues — the affected
values were then re-translated normally.

A frozen key is **not** forced to English: it keeps whatever the catalogue
already holds and falls back to English only when the key is missing, so a
considered translation (`Wikipédia`, `Kleinkastell`) is permanent and a newly
added wordmark is safe before anyone has translated it. The `schemes.*`
wordmarks are listed individually rather than freezing the namespace, so
descriptive labels beside them (`schemes.dare`, "Digital Atlas of the Roman
Empire") stay translatable — the cost is that **a new link scheme or site
category has to be added to the list by hand**.

The list has since grown a third category beyond wordmarks and site
vocabulary: **monument and printing terms**. "Column Reliefs" came back as
financial relief (`Kolomaflossingen`, `Allégements de colonnes`), and
"plate" — a Cichorius Tafel — as a licence plate (`Kennnummer des
Kennzeichens`, `Nummerplaat`) or a dinner plate (`Numero piatto`), so
`columns.pager.*` and the monument titles are frozen too. So is "Overlay" in
its cartographic sense, which came back as superimposition
(`Überlagerungen`), covers (`Couvertures`) and surfaces (`Superficies`);
each locale now carries its own mapping-software word for it — Calques,
Capas, Livelli, Overlays.

**The pre-commit hook keeps the five locales from drifting.** When
`i18n/locales/en.json` is staged, `.husky/pre-commit` runs
`scripts/i18n/translate-locales.ts` before `lint-staged` and stages whatever
it changes — the script is already resumable and a no-op in well under a
second when nothing is pending, so this costs nothing on a commit that didn't
touch strings. A translation failure (LibreTranslate unreachable, most likely)
blocks the commit with the same message the script prints standalone, rather
than letting an English source change ship with four stale locales and a
fifth that quietly reads the same as English.

`app/composables/ui/useUiLocale.ts` wraps `useI18n()` the way `useColorScheme.ts`
wraps `useColorMode()` — except colour mode leans entirely on `@nuxt/ui`'s
built-in module for persistence, and there is no locale equivalent, so the
cookie handling is new here. `LanguageSwitcher.vue` sits beside
`ThemeToggle.vue` in both layout headers.

**Component migration now covers `app/components/`, `app/pages/` and the
composables/shared utilities their strings came from.** A handful of pure
functions with no guaranteed i18n context (`useGeolocation`'s error state,
`useSiteQuery`'s `formatPeriod`, `useLimes`'s `formatFrontierYears` and
`formatOffset`, `checkPasswordRules`) were changed to return a code or accept
a `t` function from the calling component rather than a hardcoded English
string — the pattern to follow for the next one like it. What vici's own
source calls a site or tracing by (`sites.category`, six languages' worth of
`psummaries`/`ptexts`) is unaffected; only this app's own interface chrome is
translated.
