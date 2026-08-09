import Redis from "ioredis";

import { type ReplayStore, createRedisReplayStore } from "./verify";

let redis: Redis | null = null;
let replayStore: ReplayStore | null = null;

function getRedis(url = process.env.REDIS_URL): Redis {
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

export function getReplayStore(): ReplayStore {
  if (!replayStore) {
    replayStore = createRedisReplayStore(getRedis());
  }
  return replayStore;
}

export async function disconnectRedisForTests(): Promise<void> {
  if (redis) {
    redis.disconnect();
    redis = null;
    replayStore = null;
  }
}
