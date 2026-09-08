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

**A fourth category: a domain word that is also an ordinary word in the
target language.** "Limes" — the Roman frontier — was never frozen because
it never looked like a wordmark or an obviously specialist term, and stood
alone as a short label ("Follow the limes"). Every Romance-language
catalogue read it as the citrus fruit instead: "Volg de limoenen" (Dutch,
"follow the limes/fruit"), "Seguir los limones" (Spanish, "follow the
lemons"), "Suivre les chaux" (French, "follow the quicklime"), "Seguire le
calce" (Italian, same). German alone came through correct, because "der
Limes" happens to be the actual German historical term too — which is what
let this sit unnoticed for a while: one of five locales looking right is
not evidence the other four do. Caught only while checking the licence
page for an unrelated request, by reading every locale's value side by
side rather than trusting any single one. `basemapSwitcher.followLimes` is
now frozen; `followLimesHint` was already fine in every locale, since it
describes the frontier ("the border, its walls and its forts") rather than
naming it.

**A full five-locale human audit (2026-09-07) found the "limes" bug had three more instances the frozen-key list had missed** — `limesPanel.theLimes`, `limesSectorPage.theLimes` and `limesIndexPage.title` (all just "The limes" as a standalone page title or panel heading) read as "Les chaux"/"Los limones"/"Le calce"/"De limoenen" in fr/es/it/nl, the exact same fruit/quicklime confusion `followLimes` had already been fixed for. All three are now frozen too (see `translate-locales.ts`). The lesson repeats the original one: one correct locale (German, where "der Limes" happens to also be right) is never evidence the other four are — the bug has now recurred twice in the same file for the same reason, missed both times until someone read every locale side by side rather than trusting the pipeline's own idea of "already fixed."

That audit went well beyond "limes" and corrected roughly 600 translations across all five locales — five parallel review passes (one per locale, comparing against `en.json` key by key), not spot checks. Recurring bug classes found, most of them **not** specific to any one locale:

- **A dropped space around an interpolated placeholder**, e.g. German `"{count}ausgewählt"` instead of `"{count} ausgewählt"` — the exact class of bug `restoreSurroundingSpace` (below) exists to prevent, but it had reached dozens of keys across every locale regardless, mostly ones translated in later, smaller batches after the original fix landed. Worth treating as a standing risk for any future batch translation, not a one-time cleanup.
- **False friends from literal machine translation**: "Sign in" → "Firma" (Italian, actually "signature") on five separate keys, including `layout.signIn` and `layout.signOut` both reading identically; "Save" → "Sparen"/"Salvado" (German/Spanish "economize"/"rescue a soul" rather than persist data); "Caption" → "Gorra"/"Titel" (Spanish "cap [hat]", Dutch/German "title"); "Cancel" → "Stornierung" (German, "cancellation of an order", a noun, not the verb a button needs).
- **Truncated body text**, worst in Dutch: `licence.recordsBody` and `privacy.photographBody` were cut off mid-clause, dropping the actual GDPR-relevant content (what EXIF stripping removes, what the CC licence permits) and leaving only the lead-in.
- **Untranslated debris left mid-sentence** from a bulk translation pass: `"kept 7 giorni"`, `"a más de un'ora"` (which also _inverted_ the meaning of "at most one hour"), a stray "♪" character, brand names mangled ("1Password" → "1Mot de passe" in French).
- **Register drift within a single file** — most locales settle on one formality level (e.g. Dutch informal "je", French formal "vous") but individual keys or whole sections (commonly `settings.twoFactor.*`, translated in a separate batch) slip into the other register, including switching pronoun mid-sentence in the same string.

None of this is fixable by freezing more keys — freezing only helps proper nouns and short standalone labels a general model reliably mis-senses. The rest is ordinary translation quality drift from iterative machine-translation batches never getting a full human read-through end to end. There is no automated guard for it; this was a manual audit and will need to be repeated periodically, not something the pre-commit pipeline below catches.

**Translation-engine alternatives were investigated (2026-09-08) and rejected — LibreTranslate stays.** Four self-hosted, open-source alternatives were built and benchmarked against the live dev LibreTranslate instance, not just read about:

| Engine                                                                    | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LTEngine** (LLM via llama.cpp, AGPL-3.0, LibreTranslate-API-compatible) | CPU-only: 13.8s/sentence (100x slower than current). Under concurrent load, 40% of requests were rejected outright with a non-JSON "Server busy" body rather than queued — a real request-loss bug, not just slowness. Ruled out.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **NLLB-200-distilled-600M** (Meta, CC-BY-NC-4.0 — noncommercial only)     | ~4x slower than current. Fails the same "limes → fruit" ambiguity in **all five** target languages, including German (the one locale every other engine gets right). Worse: silently **drops whole sentences** from multi-sentence strings — confirmed on `verifyPage.missingToken` (dropped the actionable second sentence in all 5 languages) and `privacy.minorsBody` (dropped the first sentence in 3 of 5). Licence alone would block adoption; the truncation bug is disqualifying regardless.                                                                                                                                                                                                                                                                          |
| **OPUS-MT / Marian-NMT** (Helsinki-NLP models via CTranslate2, CC-BY-4.0) | The one genuine improvement: ~2.5x **faster** than current LibreTranslate (80ms vs 200ms/sentence, ~550MB RAM per loaded direction), handles concurrent load without dropping anything, and fixes several concrete false-friend bugs (`Sign in`→`Firma`, `Save`→`Sparen`, `Cancel`→`Stornierung`) this project's own de/it/es locales had. Its own defect: a reproducible "deep-zoom → zoo" mistranslation specific to the **English→Italian** direction (confirmed twice independently), plus that same direction occasionally echoes English straight through untranslated with no error signal. One model **per direction** (5 needed for full coverage), and no maintained production server exists for it (see below) — adopting it means owning a hand-written wrapper. |

**No pre-built "production-grade" OPUS-MT server exists today, despite two real candidates with genuine track records.** Both were actually run, not just evaluated by star count: **EasyNMT** (UKPLab, 1.3k stars, Apache-2.0, official `easynmt/api:2.0-cpu` Docker image) fails to load any OPUS-MT tokenizer out of the box — its image ships `transformers==4.19.2`, too old to parse the tokenizer format Hugging Face serves today (confirmed non-transient: network access from inside the container is fine, the tokenizer files themselves fetch correctly). **Helsinki-NLP's own official `Opus-MT` server** (the model authors' own repo, 857 stars, MIT) fails to even build — its Dockerfile targets `debian:buster`, whose package repos were pulled from the live Debian mirror after EOL, so `apt-get update` 404s before Marian is even compiled. Both looked credible on paper; neither works today. A hand-written CTranslate2 + Flask wrapper (as piloted) is, right now, the only thing that actually runs.

**Verdict: stay on LibreTranslate/Argos.** OPUS-MT is a real, measured upgrade on throughput and several specific bugs, but the gain doesn't clear the bar of committing to build and maintain a bespoke production server for it, given no existing tool does that job. Revisit only if a maintained OPUS-MT server appears, or if GPU capacity ever makes LTEngine's latency viable.

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
