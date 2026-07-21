export interface AccessContext {
  userId: string;
  email: string;
  isAdmin: boolean;
  chapterIds: string[];
  capturedAt: string;
  claimsAvailable: boolean;
  source: "web" | "discord" | "system";
}

export type IngestionChannel = "web" | "analysis" | "discord" | "google_chat";

/** Channel-neutral request envelope used by all ingestion entry points. */
export interface IngestionRequest {
  sessionId: string;
  actorId: string;
  channel: IngestionChannel;
  access: AccessContext;
}

export function createAccessContext(input: {
  userId: string;
  email?: string | null;
  isAdmin?: boolean | null;
  chapterIds?: readonly string[];
  claimsAvailable: boolean;
  source: AccessContext["source"];
}): AccessContext {
  return {
    userId: input.userId,
    email: input.email?.trim().toLowerCase() ?? "",
    isAdmin: input.isAdmin === true,
    chapterIds: [...new Set(input.chapterIds ?? [])],
    capturedAt: new Date().toISOString(),
    claimsAvailable: input.claimsAvailable,
    source: input.source,
  };
}
