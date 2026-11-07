import { REFERENCE_KINDS, type ReferenceKind } from "~/features/assets/asset";

export type DesignReference = {
  id: string;
  chapterId: number;
  kind: ReferenceKind;
  event: string;
  madeOn: string;
  note: string;
  contentType: string;
  bytes: number;
  r2Key: string;
  createdBy: string;
  createdAt: number;
};

type Row = {
  id: string;
  chapter_id: number;
  kind: string;
  event: string;
  made_on: string;
  note: string;
  content_type: string;
  bytes: number;
  r2_key: string;
  created_by: string;
  created_at: number;
};

const toReference = (r: Row): DesignReference => ({
  id: r.id,
  chapterId: r.chapter_id,
  kind: (REFERENCE_KINDS as readonly string[]).includes(r.kind)
    ? (r.kind as ReferenceKind)
    : "other",
  event: r.event,
  madeOn: r.made_on,
  note: r.note,
  contentType: r.content_type,
  bytes: r.bytes,
  r2Key: r.r2_key,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

export const referenceKey = (chapterId: number, id: string) =>
  `design-references/${chapterId}/${id}`;

export function newReferenceId(): string {
  const random = crypto.getRandomValues(new Uint8Array(9));
  return `ref-${[...random]
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 16)}`;
}

export async function insertReference(
  db: D1Database,
  r: Omit<DesignReference, "createdAt">,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO design_references (id, chapter_id, kind, event, made_on, note, content_type, bytes, r2_key, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      r.id,
      r.chapterId,
      r.kind,
      r.event,
      r.madeOn,
      r.note,
      r.contentType,
      r.bytes,
      r.r2Key,
      r.createdBy,
    )
    .run();
}

/** Newest first: the person's judgement is the latest one. */
export async function listReferences(
  db: D1Database,
  chapterId: number,
): Promise<DesignReference[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM design_references WHERE chapter_id = ? ORDER BY made_on DESC, created_at DESC LIMIT 300",
    )
    .bind(chapterId)
    .all<Row>();
  return results.map(toReference);
}

export async function getReference(db: D1Database, id: string): Promise<DesignReference | null> {
  const row = await db
    .prepare("SELECT * FROM design_references WHERE id = ?")
    .bind(id)
    .first<Row>();
  return row ? toReference(row) : null;
}

export async function deleteReference(
  db: D1Database,
  chapterId: number,
  id: string,
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM design_references WHERE chapter_id = ? AND id = ?")
    .bind(chapterId, id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/**
 * Which references an asset job sees: the matching kind first (newest), then the face and the
 * other kinds so the family is visible. `limit` is constants.design.referenceImagesPerJob.
 */
export function pickReferences(
  all: DesignReference[],
  kind: ReferenceKind | "kit",
  limit: number,
): DesignReference[] {
  const sorted = [...all].sort((a, b) =>
    b.madeOn === a.madeOn ? b.createdAt - a.createdAt : b.madeOn.localeCompare(a.madeOn),
  );
  const chosen: DesignReference[] = [];
  const take = (pred: (r: DesignReference) => boolean, n: number) => {
    let left = n;
    for (const r of sorted) {
      if (chosen.length >= limit || left <= 0) break;
      if (!chosen.includes(r) && pred(r)) {
        chosen.push(r);
        left--;
      }
    }
  };
  if (kind === "kit") {
    take((r) => r.kind === "thumbnail", Math.ceil(limit / 2));
    for (const k of ["session", "ad", "ig", "post", "print"] as const) take((r) => r.kind === k, 1);
  } else {
    take((r) => r.kind === kind, Math.max(2, limit - 2));
    take((r) => r.kind === "thumbnail", 1);
  }
  take(() => true, limit);
  return chosen.slice(0, limit);
}
