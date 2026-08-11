const STORAGE_STATE_KEY = "connpass:bot:storageState";

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
}

export function botCredentials(env: Env): { email: string; password: string } {
  const email = env.CONNPASS_BOT_EMAIL?.trim();
  const password = env.CONNPASS_BOT_PASSWORD?.trim();
  if (!email || !password) {
    throw new Error("connpass_bot_credentials_missing");
  }
  return { email, password };
}
