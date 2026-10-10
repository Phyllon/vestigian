/**
 * `Popup.setHTML` renders raw markup, unlike every Vue template in this app —
 * the one place here that needs its own escaping rather than relying on
 * `{{ }}`. A title may come from Wikidata or Pleiades rather than from a
 * visitor, but nothing here is worth relying on that for.
 *
 * Its own file, not `useBattleOverlay.ts` where it began: the shared popup
 * helpers import it, and every overlay imports those, so living inside one
 * overlay made a circle.
 */
export const escapeHtmlForPopup = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => `&#${char.codePointAt(0)};`)
