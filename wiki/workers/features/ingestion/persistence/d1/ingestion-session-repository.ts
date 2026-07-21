import { and, eq, inArray, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "~/db/schema";
import type {
  AccessContext,
  AiDraftJson,
  ChangesetOperation,
} from "../../../../../shared/ingestion/domain";
import {
  type IngestionContextManifest,
  parseIngestionContextManifest,
  stringifyIngestionContextManifest,
} from "../serialization/context-manifest-codec";
import {
  parseIngestionDraft,
  stringifyIngestionDraft,
} from "../serialization/ingestion-draft-codec";
import {
  type PersistedIngestionInputs,
  parsePersistedIngestionInputs,
  stringifyPersistedIngestionInputs,
} from "../serialization/session-inputs-codec";

export type IngestionSessionStatus =
  | "pending"
  | "processing"
  | "awaiting_url_selection"
  | "awaiting_clarification"
  | "done"
  | "error"
  | "archived";

export interface IngestionSession {
  id: string;
  userId: string;
  status: IngestionSessionStatus;
  inputs: PersistedIngestionInputs;
  draft: AiDraftJson | null;
  workflowId: string | null;
  accessContext: AccessContext | null;
  contextManifest: IngestionContextManifest;
  errorMessage: string | null;
  phaseMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateIngestionSession {
  id: string;
  userId: string;
  inputs: PersistedIngestionInputs;
  accessContext: AccessContext;
  status?: Extract<IngestionSessionStatus, "pending" | "processing">;
}

export interface IngestionSessionRepository {
  create(input: CreateIngestionSession): Promise<void>;
  findById(sessionId: string): Promise<IngestionSession | null>;
  findOwned(sessionId: string, userId: string): Promise<IngestionSession | null>;
  setPhase(sessionId: string, phaseMessage: string | null): Promise<void>;
  setWorkflowId(sessionId: string, workflowId: string): Promise<void>;
  setWorkflowIdIfMissing(sessionId: string, workflowId: string): Promise<boolean>;
  clearWorkflowIdIfCurrent(sessionId: string, workflowId: string): Promise<boolean>;
  transition(
    sessionId: string,
    expected: readonly IngestionSessionStatus[],
    next: IngestionSessionStatus,
    patch?: {
      phaseMessage?: string | null;
      errorMessage?: string | null;
      draft?: AiDraftJson | null;
    },
  ): Promise<boolean>;
  saveDraft(sessionId: string, draft: AiDraftJson): Promise<void>;
  replaceOperation(sessionId: string, index: number, operation: ChangesetOperation): Promise<void>;
  updateContextManifest(sessionId: string, manifest: IngestionContextManifest): Promise<void>;
}

function parseStatus(value: string): IngestionSessionStatus {
  const valid: readonly IngestionSessionStatus[] = [
    "pending",
    "processing",
    "awaiting_url_selection",
    "awaiting_clarification",
    "done",
    "error",
    "archived",
  ];
  if (!valid.includes(value as IngestionSessionStatus)) {
    throw new Error(`Unknown ingestion session status: ${value}`);
  }
  return value as IngestionSessionStatus;
}

function parseAccessContext(value: string | null): AccessContext | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as AccessContext;
  } catch {
    return null;
  }
}

export class D1IngestionSessionRepository implements IngestionSessionRepository {
  private readonly db;

  constructor(database: D1Database) {
    this.db = drizzle(database, { schema });
  }

  async create(input: CreateIngestionSession): Promise<void> {
    const now = new Date();
    await this.db.insert(schema.ingestionSessions).values({
      id: input.id,
      userId: input.userId,
      status: input.status ?? "processing",
      inputsJson: stringifyPersistedIngestionInputs(input.inputs),
      accessContextJson: JSON.stringify(input.accessContext),
      createdAt: now,
      updatedAt: now,
    });
  }

  async findById(sessionId: string): Promise<IngestionSession | null> {
    const row = await this.db
      .select()
      .from(schema.ingestionSessions)
      .where(eq(schema.ingestionSessions.id, sessionId))
      .get();
    return row ? this.toSession(row) : null;
  }

  async findOwned(sessionId: string, userId: string): Promise<IngestionSession | null> {
    const row = await this.db
      .select()
      .from(schema.ingestionSessions)
      .where(
        and(
          eq(schema.ingestionSessions.id, sessionId),
          eq(schema.ingestionSessions.userId, userId),
        ),
      )
      .get();
    return row ? this.toSession(row) : null;
  }

  async setPhase(sessionId: string, phaseMessage: string | null): Promise<void> {
    await this.db
      .update(schema.ingestionSessions)
      .set({ phaseMessage, updatedAt: new Date() })
      .where(eq(schema.ingestionSessions.id, sessionId));
  }

  async setWorkflowId(sessionId: string, workflowId: string): Promise<void> {
    await this.db
      .update(schema.ingestionSessions)
      .set({ workflowId, updatedAt: new Date() })
      .where(eq(schema.ingestionSessions.id, sessionId));
  }

  async setWorkflowIdIfMissing(sessionId: string, workflowId: string): Promise<boolean> {
    const result = await this.db
      .update(schema.ingestionSessions)
      .set({ workflowId, updatedAt: new Date() })
      .where(
        and(
          eq(schema.ingestionSessions.id, sessionId),
          isNull(schema.ingestionSessions.workflowId),
        ),
      )
      .run();
    return result.meta.changes > 0;
  }

  async clearWorkflowIdIfCurrent(sessionId: string, workflowId: string): Promise<boolean> {
    const result = await this.db
      .update(schema.ingestionSessions)
      .set({ workflowId: null, updatedAt: new Date() })
      .where(
        and(
          eq(schema.ingestionSessions.id, sessionId),
          eq(schema.ingestionSessions.workflowId, workflowId),
        ),
      )
      .run();
    return result.meta.changes > 0;
  }

  async transition(
    sessionId: string,
    expected: readonly IngestionSessionStatus[],
    next: IngestionSessionStatus,
    patch: {
      phaseMessage?: string | null;
      errorMessage?: string | null;
      draft?: AiDraftJson | null;
    } = {},
  ): Promise<boolean> {
    if (expected.length === 0) return false;
    const result = await this.db
      .update(schema.ingestionSessions)
      .set({
        status: next,
        ...(patch.phaseMessage !== undefined ? { phaseMessage: patch.phaseMessage } : {}),
        ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage } : {}),
        ...(patch.draft !== undefined
          ? { aiDraftJson: patch.draft ? stringifyIngestionDraft(patch.draft) : null }
          : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.ingestionSessions.id, sessionId),
          inArray(schema.ingestionSessions.status, [...expected]),
        ),
      )
      .run();
    return result.meta.changes > 0;
  }

  async saveDraft(sessionId: string, draft: AiDraftJson): Promise<void> {
    await this.db
      .update(schema.ingestionSessions)
      .set({ aiDraftJson: stringifyIngestionDraft(draft), updatedAt: new Date() })
      .where(eq(schema.ingestionSessions.id, sessionId));
  }

  async replaceOperation(
    sessionId: string,
    index: number,
    operation: ChangesetOperation,
  ): Promise<void> {
    const session = await this.findById(sessionId);
    if (!session?.draft || (session.draft.phase && session.draft.phase !== "result")) {
      throw new Error("Draft is not available");
    }
    if (!Number.isInteger(index) || index < 0 || !session.draft.operations[index]) {
      throw new Error("Operation not found");
    }
    const draft = structuredClone(session.draft);
    draft.operations[index] = operation;
    draft.sensitiveItems = draft.operations.flatMap(
      (item) => item.draft?.sensitiveItems ?? item.patch?.sensitiveItems ?? [],
    );
    await this.saveDraft(sessionId, draft);
  }

  async updateContextManifest(
    sessionId: string,
    manifest: IngestionContextManifest,
  ): Promise<void> {
    await this.db
      .update(schema.ingestionSessions)
      .set({
        contextManifestJson: stringifyIngestionContextManifest(manifest),
        updatedAt: new Date(),
      })
      .where(eq(schema.ingestionSessions.id, sessionId));
  }

  private toSession(row: typeof schema.ingestionSessions.$inferSelect): IngestionSession {
    return {
      id: row.id,
      userId: row.userId,
      status: parseStatus(row.status),
      inputs: parsePersistedIngestionInputs(row.inputsJson),
      draft: parseIngestionDraft(row.aiDraftJson),
      workflowId: row.workflowId,
      accessContext: parseAccessContext(row.accessContextJson),
      contextManifest: parseIngestionContextManifest(row.contextManifestJson),
      errorMessage: row.errorMessage,
      phaseMessage: row.phaseMessage,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
