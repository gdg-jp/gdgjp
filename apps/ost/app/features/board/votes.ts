/** Pure vote helpers. The Durable Object tallies in SQL; this mirrors it for
 * tests and any client-side aggregation. */

export function tallyVotes(rows: { topicId: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.topicId] = (out[r.topicId] ?? 0) + 1;
  return out;
}

export function hasVoted(myVotes: Iterable<string>, topicId: string): boolean {
  for (const id of myVotes) if (id === topicId) return true;
  return false;
}
