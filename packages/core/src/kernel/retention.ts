// How long what the system keeps is kept: each period once, read by the pruning jobs and written
// out in docs/legal/retention.md. The document, its signed and authorized XML, its timeline and
// one summary row per SRI exchange are kept for the tax period and never pruned; only the
// technical duplicates below are.
export const RETENTION = {
  // The raw copy of what SRI answered (`sri_exchanges.raw`), kept for support only.
  sriRawDays: 90,
} as const;
