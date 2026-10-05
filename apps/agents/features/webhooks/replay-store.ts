import { getRedis } from "../../lib/redis";
import { type ReplayStore, createRedisReplayStore } from "./verify";

export function getReplayStore(): ReplayStore {
  return createRedisReplayStore(getRedis());
}
