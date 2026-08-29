/**
 * fontnik ships no types. Only `range` is used — by `scripts/build-glyphs.ts`,
 * which runs by hand when the label fontstack changes — so only `range` is
 * described here rather than transcribing an API nothing calls.
 */
declare module 'fontnik' {
  export const range: (
    options: { font: Buffer; start: number; end: number },
    callback: (error: Error | null, glyphs: Buffer) => void,
  ) => void
}
