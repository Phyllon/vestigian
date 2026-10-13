import type { FoldableSheetOptions } from './useFoldableSheet'

const FOLDED_STATE_KEY = 'record-sheet-folded'

/**
 * Whether the open record sheet (site, tracing or the pile picker) is folded
 * down to its handle. One flag for all three: only one of them is ever on
 * screen, and `pages/index.vue` reads it to lift the control column clear of
 * the folded sheet, as it does for the frontier panel.
 */
export const useIsRecordSheetFolded = () => useState<boolean>(FOLDED_STATE_KEY, () => false)

/**
 * `useFoldableSheet` for the three record panels, with the folded state shared
 * through `useIsRecordSheetFolded`. Without a way to fold them, a record sheet
 * covers up to 78% of a phone and the map it was opened from is gone — the
 * frontier panel got its handle first (`LimesPanel`), these were left behind.
 */
export const useRecordSheet = (options: Omit<FoldableSheetOptions, 'isCollapsed'>) =>
  useFoldableSheet({ ...options, isCollapsed: useIsRecordSheetFolded() })
