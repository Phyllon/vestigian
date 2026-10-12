# Requests for permission to use source data

Drafts of the emails that the runbook's "Still open" list (§19) asks for, written
2026-10-11. **None has been sent.** Each file is one email, ready to paste, with a
header table above the rule saying who it goes to, what it asks and what happens
on a yes.

| #   | Source                                                 | Language | Send to                                            | The question                                                              |
| --- | ------------------------------------------------------ | -------- | -------------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | [Oxford Roman Economy Project](01-oxrep.en.md)         | English  | the co-directors (address **to find**)             | Terms, and may six databases be drawn as a layer                          |
| 2   | [EDH photographs](02-edh-photographs.de.md)            | German   | EDH, Heidelberg (address **to find**)              | May the 43,199 rights-reserved photographs be shown, and how              |
| 3   | [AFE](03-afe.de.md)                                    | German   | `afe@dainst.de`                                    | Which licence for the single-find data                                    |
| 4   | [PAS](04-pas.en.md)                                    | English  | PAS / British Museum (address **to find**)         | Which licence (CC BY 3.0 or ShareAlike), bulk access, find-spot precision |
| 5   | [Verein Deutsche Limes-Straße](05-limes-strasse.de.md) | German   | `limesstrasse@aalen.de` (read from their own page) | May the course of the German Limes be drawn and stored                    |

The visible-promotion offer every email makes is worked out in
[00-visual-promotion-proposal.md](00-visual-promotion-proposal.md). The emails
promise only what that file marks as on offer.

## Suggested order

1. **Limes-Straße** — one file, a small association, and a yes changes the map
   immediately (their line replaces ours for the ORL and the German Rhine).
2. **AFE** — a direct address and a single yes/no on a licence.
3. **EDH** — an existing relationship (the texts are already used under CC BY-SA),
   but rights holders may be many, so the answer can be partial.
4. **OxREP** — academic, likely slow; the Cities database may carry its own licence
   through its Bodleian DOI, worth checking first in a browser.
5. **PAS** — an institution, and the access question is technical as well as legal.

## Before sending any of them

- [ ] **Fill in the addresses marked "to find".** Nothing here was guessed: OxREP's
      team page lists no email, the EDH and PAS sites challenge scripts. Look them up in
      a browser. A named contact is better than "Sehr geehrte Damen und Herren".
- [ ] **"Non-commercial" is a claim.** Every email says Vestigian is run
      non-commercially, with no advertising and no tracking. The no-advertising and
      no-tracking parts are on the About page; "non-commercial" is inferred from the
      NC-licensed layers already shown. Confirm it is how you want to describe the
      project, since a source may rely on it.
- [ ] **The signature.** Drafts are signed Alex Lernbecher with the Impressum
      contact address (the public one — this repository is public, so no personal
      address is used). The Impressum names René Voorburg as co-operator; add him
      to the signature if he should be part of the request.
- [ ] **The numbers.** "Some 60,000 sites", "some 79,000 inscriptions" and 43,199
      photograph records come from the dev database and the 3 Oct 2026 check; confirm
      the first two against production.
- [ ] **Things the emails say we do today** — still true? EDH photographs are
      link-out only; the Limes-Straße GPX is not in the database (checked
      2026-10-11: it is only referred to in the runbook and rules); nothing from the
      other sources is imported.
- [ ] **The visibility paragraph** offers a layer name with a mark, a cartouche and a
      partner page. Only the partner page exists (`/partners`, in the menu; it shows
      invented examples in development and nothing in production until a real partner is
      added). The named layer and the cartouche are not built (see the proposal). If you
      would rather not offer all three, cut the paragraph, not the sentence that says the
      baseline credit stands either way.
- [ ] **PAS scope.** Paragraph 3 of that draft limits the request to Roman-period
      finds, beginning with coins. That is my reading of the runbook, not something
      you wrote.
- [ ] **Send one at a time** and keep each reply in this folder (`replies/`), so a
      later session can see exactly what was granted and in whose words.

## Facts the drafts rely on, and where each was checked

| Claim                                                                                                     | Source                                                                            |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Vestigian is free, no account to browse, no ads, no tracking, EU                                          | `about.whoBody`, `about.euNoTracking`, `about.euIntro` (`i18n/locales/en.json`)   |
| Records CC BY-SA, structured metadata CC0, began from vici.org                                            | `licence.recordsBody`; `README.md`                                                |
| Impressum contact address                                                                                 | `impressum.contactPlaceholder`                                                    |
| OxREP: "Content: OXREP, 2005–2026", no licence; co-directors; Cities coordinator Jack Hanson              | pages read 2026-10-11 (`oxrep.classics.ox.ac.uk`, `/team/`, `/databases/cities/`) |
| OxREP copyright page behind SSO; quarries accurate "to within several kilometres", coordinates in the PDF | `.claude/rules/antiquity-basemaps.md`, "Researched and rejected"                  |
| EDH texts CC BY-SA 4.0; data reuse article                                                                | `epigraphic-database-heidelberg/data` README (fetched 2026-10-11)                 |
| 43,199 photographs, all Europeana `rr-f`                                                                  | `.claude/rules/epigraphy.md`; re-checked 3 Oct 2026 against 2,000 local files     |
| AFE: no licence stated, Impressum reserves rights, CSV export                                             | `.claude/rules/antiquity-basemaps.md`, "Single coin finds" (checked 2026-09-14)   |
| PAS: CC BY 3.0 + "Share-Alike" in one paragraph; attribution wording; Cloudflare 403                      | Wayback copy of 3 Dec 2025; `.claude/rules/reference-overlays.md`                 |
| Limes-Straße: address, file name, Kleve–Passau, no licence, only "© OpenStreetMap-Mitwirkende"            | their GPS-data page, read 2026-10-11                                              |
| 96 % of their track within 1 km of our line; file not stored                                              | `.claude/rules/antiquity-basemaps.md`, "Traced lines"; repository searched        |

## When a reply comes

- **Yes, and they want to be named:** add them to `PARTNERS` in
  `shared/utils/partners.ts` with their words under `partnersPage.entries.<id>` in all
  six locales (they approve the wording), and put their mark under `public/partner-assets/`.
- **Yes:** record the exact wording of the grant (and the citation form they asked
  for) in this folder, then follow the runbook and the rules file named in the
  email's header. A new layer takes an entry in `REFERENCE_SOURCES`, a
  `*_ATTRIBUTION`, a licence-page entry in six locales and a key section; the
  licence terms go in verbatim. **Never import before the reply is in writing.**
- **No, or silence:** nothing changes; note the date and the answer in the runbook
  bullet so the task is closed, not forgotten. Silence is not consent.
- **A condition we did not offer** (for example, no copies, link-out only): answer it
  on its own terms; the baseline in the proposal is what we can always promise.
