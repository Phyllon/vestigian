---
paths:
  - 'app/app.config.ts'
  - 'app/components/ui/**'
  - 'app/layouts/**'
---

## Header menus and the Nuxt UI defaults behind them

**A menu taller than the screen could not be scrolled** (reported on a phone: the
burger menu's last entries were out of reach). Measured at 375×500: the menu was
588px tall, its parent `overflow-hidden`, and `max-height: none`. Nuxt UI v3.3.7's
`dropdownMenu` theme does the right thing one level down — a `viewport` slot that is
`overflow-y-auto flex-1` — but puts no height on the `content` slot, so the viewport
never has less room than its list and there is nothing to scroll. Reka UI does
measure the room left and exposes it as `--reka-dropdown-menu-content-available-height`
(440px in that case); nothing in the theme reads it.

`app.config.ts` therefore sets `ui.dropdownMenu.slots.content` to
`max-h-(--reka-dropdown-menu-content-available-height)` **once, for every
`UDropdownMenu`** (`AppMenu`, `AccountMenu`, `LanguageSwitcher`, `settings.vue`) rather
than per call site — the account menu grows an admin section and would have hit the same
wall. Verified with touch emulation: a swipe inside the menu scrolls it to its last entry
and leaves it open; at 1280×800 the cap is above the menu's own height and nothing changes.

If a Nuxt UI upgrade ships its own cap, this override becomes redundant but harmless
(`tailwind-merge` keeps one `max-h`).
