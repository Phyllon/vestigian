---
'vestigian': minor
---

Add the admin command station at `/admin`, administrators only.

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
