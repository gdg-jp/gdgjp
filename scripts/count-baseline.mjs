export function countBy(items, keyOf) {
  const counts = new Map();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function compareCounts(actual, baseline, inspected = () => true) {
  const added = [];
  const increased = [];
  const shrunk = [];
  for (const [key, count] of actual) {
    const allowed = baseline.get(key);
    if (allowed === undefined) added.push({ key, count });
    else if (count > allowed) increased.push({ key, count, allowed });
  }
  for (const [key, allowed] of baseline) {
    if (!inspected(key)) continue;
    const count = actual.get(key) ?? 0;
    if (count < allowed) shrunk.push({ key, count, allowed });
  }
  return { added, increased, shrunk };
}

export function shrinkCounts(actual, baseline) {
  const next = new Map();
  for (const [key, allowed] of baseline) {
    const count = Math.min(allowed, actual.get(key) ?? 0);
    if (count > 0) next.set(key, count);
  }
  return next;
}
