# vestigian

## 1.0.0

### Major Changes

- first major release

### Minor Changes

- ce50f23: Add a first-visit introduction to the map: a welcome, then each control
  highlighted over a dimmed screen with a card that points at it and offers
  Next, Previous and Skip. Offered once per browser (one `localStorage` flag,
  written only when the visitor skips or finishes), replayable from the menu,
  translated into all six languages and laid out for phones.
- 3257fb6: The map gains a distance scale beside the key button (metric, rounded to a round distance, changing with the zoom and kept clear of the other controls), and on a phone a "turn the map with my compass" button above the locate button: the map follows the way you are facing while you walk, an arrow shows where north went, and switching it off puts north back on top. The reading pages' header (menu, language, theme, account) now stays at the top of the window when you scroll. A new Features page, in the menu, lists the things that are easy to miss with a button that opens a real example on the map — first, what a watchtower on the Roman frontier could see: it switches on the sites layer, opens the tower and puts the map on its icon with the calculated view drawn. Hardening: `/api/metrics` now answers 404 to anything that came through a proxy, and the Marcus Aurelius plate proxy refuses paths that climb out of the image service. The backup job now reports what it holds and three new alerts fire when local dumps or restic snapshots stop being pruned.
- ec200e8: The overlay menu has a "Hide all overlays" button at its top that switches every layer off in one tap.
- 1b048a6: A switch in the new map settings (the gear at the bottom right) puts the featured sites around the view on the map, scrollable, on phones too — the compact list at most half the screen tall. The choice is remembered on the device. An enlarge button in the list's header ("Big picture") shows one site at a time with its photograph across the full width (about 40% of the screen) and, underneath, its period, place, a summary, how many photographs and endorsements it has, and the photograph's credit. The settings gather the featured switch and "every site as its own marker" into one control in place of two floating buttons, and the introduction's two steps for them became one. The featured endpoint now returns that extra detail for each site.
- 8835c13: Reference marks' info boxes say more about the spot. Every mark that stands at a point (Barrington places, battles, ports, coin hoards, minor antiquities, inscriptions, mints, monuments, hillforts) now shows its coordinate, how far it is from you once you have used the locate button, and its source and licence. An "About this spot" section, fetched only when opened, adds the nearest town and country, the elevation (to a precision the tapped zoom supports), and the years the Roman state's recorded extent covered it, following the period scrubber's year when it is on. Adds `GET /api/spot`. Also fixes the Dutch "Wat" in year ranges, and makes the Coin Hoards credit link use https.
- 7702903: Sites whose markers lie on top of one another are now spread apart instead of piled: from zoom 9 they are drawn as a ring (up to eight) or a square grid of their own icons, each shrunk until they no longer cover one another, with a dot at the true place and a thin line to it. Zooming in lets them settle back where they belong. Tapping a small icon still lists everything under your finger.
- fbca6b8: The frontier now follows the real remains. Where OpenStreetMap, OpenHistoricalMap and vici.org have traced a wall or river the line is theirs (median 25–42 m off Historic England's and Historic Environment Scotland's survey polygons, against 335–413 m before); AWMC and the generalised empire edge only fill the rest, drawn dashed. Lines are told apart by colour (wall red, river teal, no built works umber) with a paper casing for contrast, and the key panel explains colour and dash in all six languages. The German Rhine and the Main section now follow the OSM river (a published Limes track is 96% within 1 km of the drawn line, up from 88%). Doubled corridors, the Langmauer box, the Veluwe chord and the Dacian province loop are gone. Opening a fort in the limes panel switches the sites layer on. Adds migration 0033 (`limes_segments.source`); the data is loaded by re-running `pnpm import:limes` and restoring the two tables (runbook §14b). The basemap mirror script now lists the bucket once and fetches only the tiles it does not hold.
- ed2ffc4: Add semantic versioning via Changesets: a `.changeset/` workflow for
  recording version-worthy changes, an automated release on push to `main`
  (version bump, changelog, git tag, GitHub Release), a soft changeset check
  on pull requests, and version-tagged deploy images.
- 6229fd6: The introduction now puts every panel away before it starts — the open record, the frontier panel, the key, the contribution form and the expanded credits — so none of them covers the control being pointed at, on phones too. It also gains steps for the compass (phones with one) and the credits.
- 6203437: Add the admin command station at `/admin`, administrators only.

  An activity stream over **every** revision, including the edits trusted
  contributors publish without review — which the moderator's queue is scoped
  away from and no screen in the application could show. Accounts with email
  addresses and standing, a per-account dossier of everything one person
  contributed, the photograph backlog plus every image with an unresolvable
  licence, an append-only audit trail, and a system panel that surfaces failed
  mail deliveries without opening Grafana.

  Accounts can now be **blocked**: login refused and every live session ended
  through a new session epoch (`users.sessions_valid_from`), while their
  published work stays on the atlas. Taking that work offline is a separate,
  counted, reversible sweep that still writes through `applyRevision()`.
  Changing a role, blocking an account and retracting work require
  re-authentication; no administrator can be blocked, for the same reason none
  can be demoted. `/moderation/contributors` is absorbed into the new panel.

### Patch Changes

- eb4fa40: The map opens on the standard OpenStreetMap sheet in light mode. Fixes long blue wedges of water across land on production (seen around Frauenfeld near the Bodensee, from zoom 9 to about 12): the Protomaps water layer also holds river centrelines, which the water fill closed into polygons. Both map views now fill polygons only, and the Standard view draws the real river and stream network and labels each river once.
- ce50f23: Every overlay's map icons now scale with zoom on the same curve as the sites (`MARKER_ICON_SIZE`), small when zoomed out and full size when zoomed in, instead of each layer carrying its own.
- 12194e5: On a phone the site, tracing and "records here" sheets can be folded down to their grey bar by dragging it or with a new chevron button, so the map is no longer hidden while a record is open.
- ce50f23: Trim what the server loads at start: the disposable-email list is read on first use
  instead of at boot, MapLibre is no longer bundled into the server render, and the
  offline panel's detail picker loads when the panel opens. Unit tests under
  `server/api` are no longer registered as routes in development.
- dadaa6b: Picking a site from the map search now switches the sites layer on, so a fortification (or any other record) you search for is marked on the map when the camera arrives instead of only opening its panel.
- db44098: On a phone, the folded "limes" panel is no longer covered by the key and the map-credit buttons: the sheet gains its own strip along the bottom for them, the key now sits on one line with the credit button, and the map controls and the featured list sit above it. The grey bar at the top of the sheet is a handle you can drag — up to open the panel, down to fold it — and the fold button eases the sheet the same way instead of jumping, while still working for keyboard and screen-reader use. The header menu (and the account and language menus) now stay inside the screen and scroll when they have more entries than fit. The featured-nearby list's scrollbar is wider, high-contrast in light and dark, and stays on screen instead of fading. The map type you last chose (Standard, Satellite, an antiquity sheet…) is remembered on your device and restored on reload, as the light/dark choice already was. When showing the sites brings a new row into the map settings (every site as its own marker), the settings button carries a small dot and its row a "New" tag until you have looked, once, not on every visit. A new Partners page, listed in the menu, presents the organisations that have agreed terms with us in their own words — alphabetically, with what is drawn from them, how to cite them and a badge they may show on their own site. Until a real partner exists it shows only invented examples, under a notice, in development. Vestigian has a mark: a wine-red V whose left arm fades out slice by slice, on the favicon and app icons, on every share card and on the "Seen on Vestigian" badge. The sitemap now lists the inscriptions (about 88,000 pages) and the reading pages it had missed, pages are stable runs of records, and a test keeps it in step with the pages of the app. A Roman watchtower on the limes now says what its guard platform could have seen: a polar diagram with its figures written on it, the view in eight directions with the numbers of the ground behind each (what shuts the view and where ground comes back), the same shapes and distances drawn on the map with a lower and a higher estimate of the tower's height beside them, a switch to see where the tower itself could be seen from, and which neighbouring towers it could have seen, with the ground between them. Each frontier sector gains "Watching the frontier": whether a signal could have passed from tower to tower along the line, where the chain breaks, how much of the line and the country beside it was overlooked by one tower and by three, and the stretches no recorded tower watched, with the links and the ground on the map. Every line tracing gains a profile of the ground along it — climb, fall, the steepest stretch — that you can move along with a finger or the arrow keys, with a dot following it on the map.
