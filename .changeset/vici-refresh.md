---
'vestigian': patch
---

The vici.org import can mirror a newer dump: `02-mysql-to-postgres.ts --refresh` overwrites existing records in place, removes what vici no longer publishes and resynchronises vici's own concordances. Without the flag nothing changes, and a re-run no longer stops on a site whose title is already taken. The runbook (§14d) gives both routes to the VPS — mirror for an unedited database, additive merge otherwise.
