const STORAGE_KEY = "checkin:settings";
const TTL_MS = 24 * 60 * 60 * 1000; // 1日

export type StoredSettings = { groupId: string; eventId: string };

// 保存から1日以内の設定のみ返す（期限切れ・不正値は破棄）
export function loadSettings(): StoredSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.groupId !== "string" ||
      typeof parsed?.eventId !== "string" ||
      typeof parsed?.savedAt !== "number" ||
      Date.now() - parsed.savedAt > TTL_MS
    ) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return { groupId: parsed.groupId, eventId: parsed.eventId };
  } catch {
    return null;
  }
}

export function saveSettings(values: StoredSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...values, savedAt: Date.now() }));
  } catch (e) {
    console.warn("Failed to save settings:", e);
  }
}
