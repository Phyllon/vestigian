---
'vestigian': patch
---

Trim what the server loads at start: the disposable-email list is read on first use
instead of at boot, MapLibre is no longer bundled into the server render, and the
offline panel's detail picker loads when the panel opens. Unit tests under
`server/api` are no longer registered as routes in development.
