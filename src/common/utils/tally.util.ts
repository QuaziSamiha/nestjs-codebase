//* SINGLE SOURCE OF TRUTH FOR "PRISMA groupBy RESULT → DASHBOARD TALLY".
//*
//* EVERY STATS REPOSITORY IN THE APP COUNTS ROWS THE SAME WAY: ONE
//* `groupBy({ by: ['status'], _count: { _all: true } })` PER ENUM COLUMN.
//* THAT RESULT IS **SPARSE** — PRISMA ONLY EMITS A ROW FOR A VALUE THAT
//* ACTUALLY OCCURS — SO A STATUS WITH NOTHING IN IT COMES BACK MISSING
//* RATHER THAN AS 0. A DASHBOARD CARD MUST NOT DISAPPEAR THE DAY ITS
//* NUMBER DROPS TO ZERO, AND THE CLIENT SHOULD NEVER HAVE TO WRITE
//* `stats.byStatus.DRAFT ?? 0` AT EVERY READ SITE, SO EVERY TALLY IS
//* DENSIFIED HERE INSTEAD — ZERO-FILLED ACROSS THE WHOLE ENUM, ONCE.

/**
 * Zero-fills a sparse `groupBy` result into a dense record keyed by every
 * member of `allKeys`.
 *
 * @param allKeys  Every legal key — pass `Object.values(SomePrismaEnum)`, so
 *                 adding a member to the schema widens the tally automatically.
 * @param rows     The raw `groupBy` rows.
 * @param keyOf    Reads the grouped column off a row.
 * @param countOf  Reads the count off a row — usually `(r) => r._count._all`.
 */
export function tallyByEnum<K extends string, R>(
  allKeys: readonly K[],
  rows: readonly R[],
  keyOf: (row: R) => K,
  countOf: (row: R) => number,
): Record<K, number> {
  const tally = Object.fromEntries(allKeys.map((key) => [key, 0])) as Record<
    K,
    number
  >;

  for (const row of rows) {
    tally[keyOf(row)] = countOf(row);
  }

  return tally;
}

/**
 * Sums a subset of an already-densified tally — "how many admins?" is
 * `sumOf(byRole, [ADMIN, SUPER_ADMIN])`. Reads a missing key as 0 so it is
 * safe against a tally that was built by hand rather than by `tallyByEnum`.
 */
export function sumOf<K extends string>(
  tally: Record<K, number>,
  keys: readonly K[],
): number {
  return keys.reduce((total, key) => total + (tally[key] ?? 0), 0);
}
