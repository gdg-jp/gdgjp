const STORAGE_STATE_KEY = "connpass:bot:storageState";
const SESSION_CHECKED_KEY = "connpass:bot:sessionCheckedAt";

export type StorageState = unknown;

export async function loadStorageState(env: Env): Promise<StorageState | undefined> {
  const raw = await env.SESSION_KV.get(STORAGE_STATE_KEY);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as StorageState;
  } catch {
    return undefined;
  }
}

export async function saveStorageState(env: Env, state: StorageState): Promise<void> {
  await env.SESSION_KV.put(STORAGE_STATE_KEY, JSON.stringify(state));
}

export async function clearStorageState(env: Env): Promise<void> {
  await env.SESSION_KV.delete(STORAGE_STATE_KEY);
  await env.SESSION_KV.delete(SESSION_CHECKED_KEY);
}

/**
 * Timestamp (epoch ms) of the last successful connpass auth verification. Lets a
 * reused warm browser session skip the dashboard round-trip when it was checked
 * recently. Plain number, no TTL — matches the storageState entry.
 */
export async function loadSessionCheckedAt(env: Env): Promise<number | null> {
  const raw = await env.SESSION_KV.get(SESSION_CHECKED_KEY);
  const n = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

export async function markSessionChecked(env: Env, at: number = Date.now()): Promise<void> {
  await env.SESSION_KV.put(SESSION_CHECKED_KEY, String(at));
}

export async function clearSessionChecked(env: Env): Promise<void> {
  await env.SESSION_KV.delete(SESSION_CHECKED_KEY);
}

export function botCredentials(env: Env): { email: string; password: string } {
  const email = env.CONNPASS_BOT_EMAIL?.trim();
  const password = env.CONNPASS_BOT_PASSWORD?.trim();
  if (!email || !password) {
    throw new Error("connpass_bot_credentials_missing");
  }
  return { email, password };
}
