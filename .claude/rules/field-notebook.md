---
paths:
  - 'server/database/schema/notebook.ts'
  - 'server/database/schema/endorsements.ts'
  - 'server/api/me/**'
  - 'server/utils/notebook.ts'
  - 'server/utils/gpx.ts'
  - 'server/utils/endorsements.ts'
  - 'app/composables/user/useNotebook.ts'
  - 'app/components/notebook/**'
  - 'shared/utils/milestones.ts'
---

## The field notebook — the reader's own traces

The project is called _traces_, and until now the one set of traces it did not
record was the visitor's own. `site_visits` and `site_bookmarks` fix that: **I
have stood here**, and **places to go**. It is the one feature here with no
analogue in vici.org, and it follows from what this atlas already claims to be —
a record made by the people who visit the places in it.

Everything else in this database is the shared record. These two tables are not,
and three rules follow from that. They are stated in
`server/database/schema/notebook.ts` and in migration `0006`, and each has an
e2e test in `e2e/notebook.spec.ts` because each would be trivially broken from
somewhere none of them live:

1. **A visit never goes through `applyRevision()`.** That function is still the
   only writer of the shared record; the handlers under `server/api/me/` are the
   only writes in the app that touch a table directly, because a private note
   about somebody's travel is not a change other people review. Sending it
   through moderation would put a moderator in front of it.
2. **The notebook never joins `/api/data/sites.geojson`** or any public feed.
   The `antiquity_*` tables are excluded from that feed for a licence reason;
   these are excluded for a data-protection one.
3. **The notebook never enters the MVT pipeline.** Tile invalidation is one
   global counter (`bumpDataVersion()`) — the reason tiles cache far longer than
   editable content normally allows. A per-user layer inside `ST_AsMVT` would
   make every cache key per-user and throw that away, for a few hundred points
   that fit in one response. The map draws them from a plain `geojson` source
   fed by `/api/me/map.geojson`, as a ring _around_ the category mark rather than
   a second glyph on the same coordinate.

Four more things worth knowing:

- **Erasure deletes the notebook outright, and that is a different decision from
  the rest of `account.delete.ts`.** That endpoint _anonymises_ rather than
  deletes, so the `ON DELETE CASCADE` on these tables never fires — a private
  record of where somebody has physically been would otherwise outlive the
  account that erased itself. The Art. 17(3)(d) archival reasoning that keeps
  contribution content does not reach it: nobody else can read a visit, and
  removing it takes nothing from the atlas. The deletes and the anonymisation
  are one transaction.
- **`visited_on` is nullable and `visited` is a column, not an inference.** "I
  have been, I do not recall when" is a real answer; a required date would be
  filled in with an invented one, and `visitedOn !== null` is therefore not the
  same question as "has this person stood here".
- **One row per person per site.** Revisiting updates rather than appends. This
  records _whether_ someone has been somewhere, not an itinerary — a log of
  repeat trips is a movement history worth more to an attacker than to its owner.
- **The GPX field kit is the offline story.** Offline tiles are still unbuilt and
  are a large piece of work; `/api/me/field-kit.gpx` is small, works on a
  handheld GPS or OsmAnd with no signal, and is most of that need.
  `server/utils/gpx.ts` is hand-written — the escaping is the only hard part and
  is the part that is tested, because an unescaped `&` in an imported title makes
  the file unparseable and a GPS reports that as "no waypoints" rather than as an
  error.

### Milestones, and why there is no game

`shared/utils/milestones.ts` derives eight named marks on read and **stores
none of them** — the same reasoning that deleted `users.trust_level` in
migration `0002`. Every mark is either _the first time_ something happened or _a
round number of_ something, so there is nothing to optimise. There are
deliberately no points, streaks, levels or leaderboards: a streak rewards
whoever lives nearest a frontier, and a leaderboard turns a shared record into a
contest that pays for thin records submitted quickly. The one mark worth having
is `recorded-and-stood` — visiting a place you yourself recorded — which is the
thesis of the project in a single fact and the only one that cannot be earned
from a desk.

### The public contributor page is opt-in and a strict projection

`users.public_profile` is off by default, and `/api/contributors/[name]` returns
display name, bio, joining **month** and published work. Never email, never role
(which would make the moderator list enumerable), never trust state (a
moderation judgement is not a public fact), and never visits or bookmarks —
that switch is about _attribution for contributions_, not general visibility.
A profile that is off answers **404, not 403**, so the route cannot be used to
enumerate display names. The month rather than the day because an exact
registration timestamp is a fingerprint. `contributor-projection.test.ts`
asserts the absences against the source.

### The account menu

`AuthAccountMenu` replaced a bare button in `default.vue` that showed the
display name and **signed you out on click** — no dropdown, no confirmation, and
no route to anything else about the account. The moderation queue stays a
header link rather than moving into the menu: moderators open it constantly.
The menu is `ClientOnly` for a different reason than `LanguageSwitcher` and
`ThemeToggle` — the session _is_ available during SSR, and a display name baked
into the HTML of `/` would be a cross-user leak the moment anyone enables edge
caching for pages, which nothing in `routeRules` currently forbids.

### Credentials

`auth/change-password.post.ts` and `auth/change-email.post.ts` both require the
**current password**: a session is proof of a past sign-in, not of present
possession, so without it a borrowed laptop is enough to take an account — worse
than the reset flow, where an attacker at least needs the inbox. Both notify,
and both ignore `notify_by_email`, because an attacker holding a session could
otherwise switch the preference off and act in silence. That switch covers
messages about your _contributions_; never messages about your _credentials_.

A change of address writes **nothing** to `users` up front. The new address is
parked on a `change-email` token (`email_tokens.new_email`) and only moves when
someone proves they can read that inbox. Writing it immediately and clearing
`email_verified_at` would leave a typo — or an address typed into a borrowed
session — locking the real owner out of an account they can still see and can no
longer recover, since `forgot-password` would now mail the wrong inbox. Two
messages go out: the link to the new address, and a warning to the **old** one,
which is the only signal reaching the genuine owner. It does not name the new
address; if the request was not theirs, that is a stranger's inbox.

`verify.post.ts` redeems both `verify-email` and `change-email`, because from the
recipient's side they ask the same thing. The purpose comes from the stored row,
never the request.

### "Found this useful" — a public count from a private table's sibling

A unique-visitor count was considered and **deliberately not built**. It would
have meant aggregating `site_visits` — the table the field-notebook section
above documents as strictly private, never joined to any public feed, for
good reason: a location history, even counted rather than listed, still
re-identifies someone on a rarely-visited site. That design was made
deliberately earlier in this project and a feature request is not, on its
own, a reason to reverse it quietly.

What exists instead is `site_endorsements` — "I found this useful," positive
only, one per person per site, open to **any signed-in reader**, not gated on
having recorded a visit at all. It looks like `site_visits` and
`site_bookmarks` (same shape: `user_id`, `site_id`, a unique index on the
pair) and is governed by a different rule, stated in
`server/database/schema/endorsements.ts`: the **count** is public from the
moment it is written — shown on every reader's view of a site — while the
**row** stays exactly as private as a bookmark. Nobody but the endorser ever
learns who endorsed a site or when, on any surface, including to a moderator
— `endorsement-projection.test.ts` asserts this the same blunt way
`contributor-projection.test.ts` asserts the contributor page's absences,
and an e2e test signs in as a moderator specifically to confirm the display
name never appears in the response. What makes the count safe to publish
where a visit count would not be: an endorsement carries no coordinate and no
timestamp anyone but its author can read. It says a place was useful, not
where someone has physically been.

Survives account erasure, unlike `site_visits`/`site_bookmarks`. Those two
are explicitly deleted in `account.delete.ts` because a private location
history has nothing to gain from surviving its owner's anonymisation.
Endorsements are left alone: the row carries no attribution any public
surface exposes, so removing it on erasure would only make the public count
wrong for no privacy benefit. `ON DELETE CASCADE` exists purely as
referential-integrity hygiene for a hard-delete path this app does not
otherwise have.

`loadSiteDetail` takes an optional `viewerId` — `null` for an anonymous
request, never a special case requiring its own branch — and answers
`endorsedByMe` via `COALESCE(bool_or(user_id = viewerId), false)` in the same
query that computes the count. `bool_or` over `user_id = NULL` is `NULL`, not
`false` (SQL: nothing equals `NULL`, including by comparison), and `bool_or`
over zero rows is also `NULL` — both cases needed the explicit `COALESCE`, and
both were caught by testing against the running database rather than
assumed.

## "Nearby, needing work" — the contribution queue

61,273 records were imported and **49,964 of them (82%) have no photograph**.
Until `/nearby` existed the application offered a map to browse and no way to
find the records that need somebody standing in front of them — which is the one
kind of work a visitor can do that nobody at a desk can. That is the cold-start
problem stated precisely, and it is a product gap rather than a technical one.

Measured against the real catalogue:

| Gap           | Sites lacking it | Share |
| ------------- | ---------------- | ----- |
| a photograph  | 49,964           | 82%   |
| a period      | 29,905           | 49%   |
| a description | 29,417           | 48%   |
| a summary     | 5                | ~0%   |

`shared/utils/completeness.ts` holds the rule (pure, tested);
`server/api/sites/needs-work.get.ts` is the query; `/nearby` is the page, public
and `noindex`.

### Three decisions worth keeping

**Only gaps the contribution form can accept are counted.** Concordances are
deliberately excluded: there is no field for them in `SiteEditorForm` and
`SitePayload` carries none, so listing a site as incomplete for lacking one
would be asking for something the application cannot receive.

**Ordered by distance, not by how incomplete a record is** — the opposite of
what it first seems it should do. The binding constraint on a visitor is where
they are; a very incomplete site forty kilometres away is not more useful than a
nearly complete one at the end of the road. Completeness decides _which records
appear at all_ and what each asks for. `?missing=photograph` is the query a
visitor actually wants.

**A photograph outranks every other gap** in the score (0.4 of 1.0), for two
reasons at once: it is the scarcest thing in the atlas by a wide margin, and it
is the only gap that genuinely requires being there. A summary is worth least
because five records lack one — weighting it heavily would rank on a distinction
that barely exists.

### The bounding-box pre-filter is not optional

`geom && ST_Expand(...)` before `ST_DWithin` is the same trap
`limes/sectors/[slug].get.ts` documents: a geography cast cannot use the GiST
index on `sites.geom`, so without it this is a sequential scan over sixty
thousand rows per request. `ST_Expand` takes **degrees**, so the radius is
converted at the query's own latitude — a fixed factor would under-cover the box
in northern Europe and silently drop sites that are genuinely in range.

Confirmed on the real table: `Index Scan using sites_approved_geom_idx`, 13–17 ms
warm (the first run's 114 ms was a cold cache).

### Two bugs found by driving it in a browser, not by any test

**The site's `Permissions-Policy` header blocked geolocation — and had been
breaking the map's own "locate me" button all along.** `nuxt.config.ts` sent
`geolocation=()`, whose comment claimed "nothing here uses them";
`useGeolocation` has always been used by `GeolocateButton.vue`. A denied
permissions policy refuses `navigator.geolocation` _before_ any prompt appears,
so the composable reports `denied` and the control reads exactly as if the
visitor had refused — which is why nobody noticed. Now `geolocation: ['self']`.

**`useFetch`'s `immediate: false` and `watch` do not combine the way they read.**
`watch` only _refreshes_ a request that has already run once, so with nothing to
refresh no request was ever made and the list stayed empty forever — with no
error anywhere. A watcher on the position fires the first `execute()`; `watch`
handles later radius and filter changes.

### Known limitation

The list can be dominated by one repetitive cluster — a search from Xanten
returns eleven `Übungslager Uedemerbruch I–XIV` practice camps in sixteen
results. The data and the ordering are both correct; it is simply what nearest
-first does where the atlas records a numbered series. Worth revisiting with
per-title-prefix diversity if it proves annoying in use, rather than
pre-emptively.
