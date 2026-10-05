import { internalRequest } from "./internal-api.js";
import { runtimeCache, runtimeCacheFailure, sharedCacheKeysForTests } from "./runtime-cache.js";
export type DomainConfig = {
  hostname: string;
  mode: "short-only" | "origin-first";
  upstreamOrigin: string | null;
};
const CONFIG_TTL_MS = 30_000;
const CONFIG_CACHE_LIMIT = 200;
const SHARED_CONFIG_TTL_SECONDS = 7 * 24 * 60 * 60;
const configCache = new Map<string, { config: DomainConfig; expiresAt: number }>();

export function clearDomainConfigCacheForTests(): void {
  configCache.clear();
}

export async function getConfig(hostname: string): Promise<DomainConfig | null> {
  const cached = configCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) return cached.config;
  const sharedKey = `config:${hostname}`;
  sharedCacheKeysForTests.add(sharedKey);
  const shared = await runtimeCache.get(sharedKey).catch((error) => {
    runtimeCacheFailure("get", sharedKey, error);
    return null;
  });
  if (
    shared &&
    typeof shared === "object" &&
    "hostname" in shared &&
    typeof shared.hostname === "string" &&
    shared.hostname.toLowerCase() === hostname &&
    "mode" in shared &&
    (shared.mode === "short-only" || shared.mode === "origin-first") &&
    "upstreamOrigin" in shared &&
    (typeof shared.upstreamOrigin === "string" || shared.upstreamOrigin === null)
  ) {
    const config = shared as DomainConfig;
    configCache.set(hostname, { config, expiresAt: Date.now() + CONFIG_TTL_MS });
    return config;
  }
  const response = await internalRequest(
    "/api/internal/gateway/config",
    hostname,
    new URLSearchParams(),
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Config service returned ${response.status}`);
  const config = (await response.json()) as DomainConfig;
  if (config.hostname.toLowerCase() !== hostname) throw new Error("Config hostname mismatch");
  if (configCache.size >= CONFIG_CACHE_LIMIT)
    configCache.delete(configCache.keys().next().value ?? "");
  configCache.set(hostname, { config, expiresAt: Date.now() + CONFIG_TTL_MS });
  await runtimeCache
    .set(sharedKey, config, {
      ttl: SHARED_CONFIG_TTL_SECONDS,
      tags: [`domain-${hostname}`],
    })
    .catch((error) => runtimeCacheFailure("set", sharedKey, error));
  return config;
}
