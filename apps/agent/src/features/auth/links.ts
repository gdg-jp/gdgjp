import { nowSeconds } from "../../lib";
import type { EncryptedPayload } from "./token-crypto";

export type ChatPlatform = "discord" | "google-chat";

/** Same shape as the v1 Redis record, so migrated links keep working. */
export type StoredLinkRecord = {
  platform: ChatPlatform;
  chatUserId: string;
  accessToken: EncryptedPayload;
  accessTokenExpiresAt: number;
  refreshToken: EncryptedPayload;
  subject: string | null;
  linkedAt: number;
};

/** Link storage with compare-and-set, so concurrent refreshes cannot both rotate a token. */
export type LinkStore = {
  read(
    platform: ChatPlatform,
    chatUserId: string,
  ): Promise<{ record: StoredLinkRecord; serialized: string } | null>;
  write(record: StoredLinkRecord): Promise<void>;
  compareAndSet(
    platform: ChatPlatform,
    chatUserId: string,
    expected: string,
    next: string,
  ): Promise<boolean>;
  compareAndDelete(platform: ChatPlatform, chatUserId: string, expected: string): Promise<boolean>;
};

export function d1LinkStore(db: D1Database): LinkStore {
  return {
    async read(platform, chatUserId) {
      const row = await db
        .prepare("SELECT record FROM account_links WHERE platform = ? AND chat_user_id = ?")
        .bind(platform, chatUserId)
        .first<{ record: string }>();
      if (!row) return null;
      try {
        return { record: JSON.parse(row.record) as StoredLinkRecord, serialized: row.record };
      } catch {
        return null;
      }
    },
    async write(record) {
      await db
        .prepare(
          `INSERT INTO account_links (platform, chat_user_id, record, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (platform, chat_user_id) DO UPDATE SET record = excluded.record, updated_at = excluded.updated_at`,
        )
        .bind(record.platform, record.chatUserId, JSON.stringify(record), nowSeconds())
        .run();
    },
    async compareAndSet(platform, chatUserId, expected, next) {
      const result = await db
        .prepare(
          "UPDATE account_links SET record = ?, updated_at = ? WHERE platform = ? AND chat_user_id = ? AND record = ?",
        )
        .bind(next, nowSeconds(), platform, chatUserId, expected)
        .run();
      return (result.meta.changes ?? 0) > 0;
    },
    async compareAndDelete(platform, chatUserId, expected) {
      const result = await db
        .prepare("DELETE FROM account_links WHERE platform = ? AND chat_user_id = ? AND record = ?")
        .bind(platform, chatUserId, expected)
        .run();
      return (result.meta.changes ?? 0) > 0;
    },
  };
}

export function memoryLinkStore(): LinkStore & { rows: Map<string, string> } {
  const rows = new Map<string, string>();
  const key = (platform: string, id: string) => `${platform}:${id}`;
  return {
    rows,
    async read(platform, chatUserId) {
      const raw = rows.get(key(platform, chatUserId));
      return raw ? { record: JSON.parse(raw), serialized: raw } : null;
    },
    async write(record) {
      rows.set(key(record.platform, record.chatUserId), JSON.stringify(record));
    },
    async compareAndSet(platform, chatUserId, expected, next) {
      if (rows.get(key(platform, chatUserId)) !== expected) return false;
      rows.set(key(platform, chatUserId), next);
      return true;
    },
    async compareAndDelete(platform, chatUserId, expected) {
      if (rows.get(key(platform, chatUserId)) !== expected) return false;
      rows.delete(key(platform, chatUserId));
      return true;
    },
  };
}
