export type DomainMode = "short-only" | "origin-first";
export type DomainStatus = "pending" | "verifying" | "active" | "error" | "deleted";
export type DomainKind = "system" | "custom";

export type DnsRecord = {
  type: "A" | "AAAA" | "CNAME" | "TXT" | "CAA";
  name: string;
  value: string;
  reason?: string;
  purpose?: "ownership" | "routing";
  status?: "pending" | "verified";
  alternativeGroup?: "apex-routing";
};

export type Domain = {
  id: number;
  hostname: string;
  kind: DomainKind;
  mode: DomainMode;
  upstreamOrigin: string | null;
  ownerChapterId: number | null;
  status: DomainStatus;
  providerDomainId: string | null;
  verificationRecords: DnsRecord[];
  providerError: string | null;
  createdByUserId: string | null;
  createdAt: number;
  updatedAt: number;
  checkedAt: number | null;
  deletedAt: number | null;
};

type DomainRow = {
  id: number;
  hostname: string;
  kind: DomainKind;
  mode: DomainMode;
  upstream_origin: string | null;
  owner_chapter_id: number | null;
  status: DomainStatus;
  provider_domain_id: string | null;
  verification_records: string;
  provider_error: string | null;
  created_by_user_id: string | null;
  created_at: number;
  updated_at: number;
  checked_at: number | null;
  deleted_at: number | null;
};

const DOMAIN_COLS =
  "id, hostname, kind, mode, upstream_origin, owner_chapter_id, status, provider_domain_id, verification_records, provider_error, created_by_user_id, created_at, updated_at, checked_at, deleted_at";

function parseRecords(value: string): DnsRecord[] {
  try {
    const records = JSON.parse(value);
    return Array.isArray(records) ? (records as DnsRecord[]) : [];
  } catch {
    return [];
  }
}

function toDomain(row: DomainRow): Domain {
  return {
    id: row.id,
    hostname: row.hostname,
    kind: row.kind,
    mode: row.mode,
    upstreamOrigin: row.upstream_origin,
    ownerChapterId: row.owner_chapter_id,
    status: row.status,
    providerDomainId: row.provider_domain_id,
    verificationRecords: parseRecords(row.verification_records),
    providerError: row.provider_error,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    checkedAt: row.checked_at,
    deletedAt: row.deleted_at,
  };
}

export async function getDomainById(db: D1Database, id: number): Promise<Domain | null> {
  const row = await db
    .prepare(`SELECT ${DOMAIN_COLS} FROM domains WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first<DomainRow>();
  return row ? toDomain(row) : null;
}

export async function getDomainByHostname(
  db: D1Database,
  hostname: string,
): Promise<Domain | null> {
  const row = await db
    .prepare(
      `SELECT ${DOMAIN_COLS} FROM domains
       WHERE hostname = ? COLLATE NOCASE AND deleted_at IS NULL`,
    )
    .bind(hostname)
    .first<DomainRow>();
  return row ? toDomain(row) : null;
}

export async function listDomainsForChapters(
  db: D1Database,
  chapterIds: number[],
  includeSystem = true,
): Promise<Domain[]> {
  if (chapterIds.length === 0 && !includeSystem) return [];
  const placeholders = chapterIds.map(() => "?").join(", ");
  const clauses = [includeSystem ? "kind = 'system'" : "0 = 1"];
  if (chapterIds.length > 0) clauses.push(`owner_chapter_id IN (${placeholders})`);
  const { results } = await db
    .prepare(
      `SELECT ${DOMAIN_COLS} FROM domains
       WHERE deleted_at IS NULL AND (${clauses.join(" OR ")})
       ORDER BY kind DESC, hostname`,
    )
    .bind(...chapterIds)
    .all<DomainRow>();
  return results.map(toDomain);
}

export type CreateDomainInput = {
  hostname: string;
  mode: DomainMode;
  upstreamOrigin: string | null;
  ownerChapterId: number;
  createdByUserId: string;
};

export async function createPendingDomain(
  db: D1Database,
  input: CreateDomainInput,
): Promise<Domain> {
  const row = await db
    .prepare(
      `INSERT INTO domains
       (hostname, kind, mode, upstream_origin, owner_chapter_id, status, created_by_user_id)
       VALUES (?, 'custom', ?, ?, ?, 'pending', ?)
       RETURNING ${DOMAIN_COLS}`,
    )
    .bind(
      input.hostname,
      input.mode,
      input.upstreamOrigin,
      input.ownerChapterId,
      input.createdByUserId,
    )
    .first<DomainRow>();
  if (!row) throw new Error("Domain insert returned no row");
  return toDomain(row);
}

export async function updateDomainProviderState(
  db: D1Database,
  id: number,
  input: {
    status: DomainStatus;
    providerDomainId?: string | null;
    verificationRecords?: DnsRecord[];
    providerError?: string | null;
  },
): Promise<Domain | null> {
  const row = await db
    .prepare(
      `UPDATE domains SET
         status = ?,
         provider_domain_id = COALESCE(?, provider_domain_id),
         verification_records = COALESCE(?, verification_records),
         provider_error = ?,
         checked_at = unixepoch(),
         updated_at = unixepoch()
       WHERE id = ? AND deleted_at IS NULL
       RETURNING ${DOMAIN_COLS}`,
    )
    .bind(
      input.status,
      input.providerDomainId ?? null,
      input.verificationRecords ? JSON.stringify(input.verificationRecords) : null,
      input.providerError ?? null,
      id,
    )
    .first<DomainRow>();
  return row ? toDomain(row) : null;
}

export async function countLinksForDomain(db: D1Database, id: number): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM links WHERE domain_id = ? AND deleted_at IS NULL")
    .bind(id)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function softDeleteDomain(db: D1Database, id: number): Promise<void> {
  await db
    .prepare(
      `UPDATE domains SET status = 'deleted', deleted_at = unixepoch(), updated_at = unixepoch()
       WHERE id = ? AND kind = 'custom' AND deleted_at IS NULL`,
    )
    .bind(id)
    .run();
}
