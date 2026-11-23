export const GOOGLE_SUBSCRIPTION_ID = 1;

export type GoogleSubscriptionRecord = {
  name: string;
  state: string;
  expireTime: string;
  updatedAt: string;
  lastError: string | null;
};

type GoogleSubscriptionRow = {
  id: number;
  name: string;
  state: string;
  expire_time: string;
  updated_at: string;
  last_error: string | null;
};

function mapSubscriptionRow(row: GoogleSubscriptionRow): GoogleSubscriptionRecord {
  return {
    name: row.name,
    state: row.state,
    expireTime: row.expire_time,
    updatedAt: row.updated_at,
    lastError: row.last_error,
  };
}

export async function getGoogleSubscription(
  db: D1Database,
): Promise<GoogleSubscriptionRecord | null> {
  const row = await db
    .prepare(
      "SELECT id, name, state, expire_time, updated_at, last_error FROM google_subscription WHERE id = ?",
    )
    .bind(GOOGLE_SUBSCRIPTION_ID)
    .first<GoogleSubscriptionRow>();
  return row ? mapSubscriptionRow(row) : null;
}

export async function upsertGoogleSubscription(
  db: D1Database,
  input: GoogleSubscriptionRecord,
): Promise<GoogleSubscriptionRecord> {
  await db
    .prepare(
      `INSERT INTO google_subscription (id, name, state, expire_time, updated_at, last_error)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name,
         state = excluded.state,
         expire_time = excluded.expire_time,
         updated_at = excluded.updated_at,
         last_error = excluded.last_error`,
    )
    .bind(
      GOOGLE_SUBSCRIPTION_ID,
      input.name,
      input.state,
      input.expireTime,
      input.updatedAt,
      input.lastError,
    )
    .run();
  return input;
}
