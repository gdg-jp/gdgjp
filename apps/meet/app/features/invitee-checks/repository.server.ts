const SQL_EMAIL_CHUNK_SIZE = 50;

export type DriveShareCheckStatus = "ok" | "unshareable";
export type DriveShareCheckSource = "probe" | "share";

export type DriveShareCheckRecord = {
  emailNormalized: string;
  status: DriveShareCheckStatus;
  httpStatus: number | null;
  apiStatus: string | null;
  source: DriveShareCheckSource;
  checkedAt: string;
};

type DriveShareCheckRow = {
  email_normalized: string;
  status: DriveShareCheckStatus;
  http_status: number | null;
  api_status: string | null;
  source: DriveShareCheckSource;
  checked_at: string;
};

export async function listDriveShareChecksByEmails(
  db: D1Database,
  emailsNormalized: readonly string[],
): Promise<Map<string, DriveShareCheckRecord>> {
  const unique = [...new Set(emailsNormalized.filter(Boolean))];
  const result = new Map<string, DriveShareCheckRecord>();
  if (unique.length === 0) return result;

  for (let offset = 0; offset < unique.length; offset += SQL_EMAIL_CHUNK_SIZE) {
    const chunk = unique.slice(offset, offset + SQL_EMAIL_CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = await db
      .prepare(
        `SELECT email_normalized, status, http_status, api_status, source, checked_at
         FROM drive_share_checks
         WHERE email_normalized IN (${placeholders})`,
      )
      .bind(...chunk)
      .all<DriveShareCheckRow>();

    for (const row of rows.results ?? []) {
      result.set(row.email_normalized, {
        emailNormalized: row.email_normalized,
        status: row.status,
        httpStatus: row.http_status === null ? null : Number(row.http_status),
        apiStatus: row.api_status,
        source: row.source,
        checkedAt: row.checked_at,
      });
    }
  }

  return result;
}

export async function upsertDriveShareCheck(
  db: D1Database,
  input: DriveShareCheckRecord,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO drive_share_checks (
         email_normalized, status, http_status, api_status, source, checked_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (email_normalized) DO UPDATE SET
         status = excluded.status,
         http_status = excluded.http_status,
         api_status = excluded.api_status,
         source = excluded.source,
         checked_at = excluded.checked_at`,
    )
    .bind(
      input.emailNormalized,
      input.status,
      input.httpStatus,
      input.apiStatus,
      input.source,
      input.checkedAt,
    )
    .run();
}

export async function getDriveProbeFileId(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare("SELECT file_id FROM drive_probe_file WHERE id = 1")
    .first<{ file_id: string }>();
  return row?.file_id ?? null;
}

export async function upsertDriveProbeFileId(
  db: D1Database,
  fileId: string,
  createdAt: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO drive_probe_file (id, file_id, created_at)
       VALUES (1, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         file_id = excluded.file_id,
         created_at = excluded.created_at`,
    )
    .bind(fileId, createdAt)
    .run();
}
