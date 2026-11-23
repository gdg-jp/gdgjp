export const D1_MAX_BOUND_PARAMETERS = 100;

export async function mapInChunks<T, R>(
  values: readonly T[],
  fetchChunk: (chunk: T[]) => Promise<R[]>,
  chunkSize: number = D1_MAX_BOUND_PARAMETERS,
): Promise<R[]> {
  if (values.length === 0) return [];
  if (chunkSize < 1) throw new Error("chunkSize must be >= 1");
  const out: R[] = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    out.push(...(await fetchChunk(values.slice(i, i + chunkSize) as T[])));
  }
  return out;
}
