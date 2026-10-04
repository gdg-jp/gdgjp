import Redis from "ioredis";

export type LinkRedis = {
  set(key: string, value: string, expiryMode: "EX", ttl: number): Promise<"OK" | null>;
  /** First-write-wins set with TTL. Returns true when this call created the key. */
  setNX(key: string, value: string, ttl: number): Promise<boolean>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<void>;
  /** Atomic get-and-delete (single-use state). */
  getdel(key: string): Promise<string | null>;
  compareAndSet(key: string, expected: string, value: string, ttl: number): Promise<boolean>;
  compareAndDelete(key: string, expected: string): Promise<boolean>;
};

const COMPARE_AND_SET_SCRIPT = `
if redis.call("GET", KEYS[1]) ~= ARGV[1] then
  return 0
end
redis.call("SET", KEYS[1], ARGV[2], "EX", ARGV[3])
return 1
`;

const COMPARE_AND_DELETE_SCRIPT = `
if redis.call("GET", KEYS[1]) ~= ARGV[1] then
  return 0
end
redis.call("DEL", KEYS[1])
return 1
`;

let redis: Redis | null = null;

export function getRedis(url = process.env.REDIS_URL): Redis {
  if (!url?.trim()) {
    throw new Error("REDIS_URL is not configured");
  }
  if (!redis) {
    redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: true,
    });
  }
  return redis;
}

/** Link-account Redis adapter with atomic serialized-record CAS operations. */
export function createLinkRedis(client: Redis): LinkRedis {
  return {
    set: (key, value, expiryMode, ttl) => client.set(key, value, expiryMode, ttl),
    async setNX(key, value, ttl) {
      return (await client.set(key, value, "EX", ttl, "NX")) === "OK";
    },
    get: (key) => client.get(key),
    async del(key) {
      await client.del(key);
    },
    getdel: (key) => client.getdel(key),
    async compareAndSet(key, expected, value, ttl) {
      return (await client.eval(COMPARE_AND_SET_SCRIPT, 1, key, expected, value, ttl)) === 1;
    },
    async compareAndDelete(key, expected) {
      return (await client.eval(COMPARE_AND_DELETE_SCRIPT, 1, key, expected)) === 1;
    },
  };
}

export async function disconnectRedisForTests(): Promise<void> {
  if (redis) {
    redis.disconnect();
    redis = null;
  }
}
