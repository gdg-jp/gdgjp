/** Cloudflare D1 allows at most 100 bound parameters per SQL statement. */
export const D1_MAX_BOUND_PARAMETERS = 100;

/**
 * Run `fetchChunk` over `values` in slices that stay within D1's bound-parameter
 * limit, concatenating the results. Empty input skips the callback.
 */
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
