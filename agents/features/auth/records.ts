import type { ChatPlatform, LinkAccountDeps, LinkRedis, StoredLinkRecord } from "./contracts";
import { linkUserKey } from "./keys";
import { LINK_RECORD_TTL_SECONDS } from "./settings";
type ReadLinkRecord = {
  record: StoredLinkRecord;
  serialized: string;
};

export async function writeLinkRecord(
  record: StoredLinkRecord,
  deps: LinkAccountDeps,
): Promise<void> {
  await deps.redis.set(
    linkUserKey(record.platform, record.chatUserId),
    JSON.stringify(record),
    "EX",
    // Bound Redis retention near the refresh-token lifetime (30 days) + slack.
    LINK_RECORD_TTL_SECONDS,
  );
}

export async function readLinkRecord(
  platform: ChatPlatform,
  chatUserId: string,
  redis: LinkRedis,
): Promise<ReadLinkRecord | null> {
  const raw = await redis.get(linkUserKey(platform, chatUserId));
  if (!raw) return null;
  try {
    return { record: JSON.parse(raw) as StoredLinkRecord, serialized: raw };
  } catch {
    return null;
  }
}
