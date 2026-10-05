import { getCache } from "@vercel/functions";
export const runtimeCache = getCache({ namespace: "tinyurl-gateway" });
export const sharedCacheKeysForTests = new Set<string>();

export async function clearSharedCacheForTests(): Promise<void> {
  await Promise.all([...sharedCacheKeysForTests].map((key) => runtimeCache.delete(key)));
  sharedCacheKeysForTests.clear();
}

export function runtimeCacheFailure(operation: "get" | "set", key: string, error: unknown): void {
  console.warn(
    JSON.stringify({
      event: "runtime_cache_failure",
      operation,
      keyType: key.split(":", 1)[0],
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}
