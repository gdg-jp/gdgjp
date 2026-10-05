import { z } from "zod";
import { sourceHasReference } from "~/features/agent-api/cli-sync-helpers";
import type { components } from "../../../openapi/types.generated";

export type WikiSyncResult = components["schemas"]["SyncResult"];

const Language = z.object({
  title: z.string(),
  summary: z.string(),
  translationStatus: z.enum(["human", "ai", "missing"]),
  content: z.string(),
});
const Access = z.object({
  subjectType: z.enum(["email", "chapter"]),
  subjectKey: z.string().min(1),
  subjectLabel: z.string(),
  role: z.enum(["viewer", "commenter", "editor"]),
});
const Source = z
  .object({
    id: z.string().optional(),
    url: z.string().optional(),
    title: z.string(),
    sourceId: z.string().nullable().optional(),
  })
  .refine(sourceHasReference, { message: "source requires title and url or sourceId" });
const Attachment = z.object({
  id: z.string().optional(),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
});
const PagePayload = z
  .object({
    id: z.string().min(1).max(128).optional(),
    slug: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    parentId: z.string().nullable(),
    sortOrder: z.number().int().min(0),
    ja: Language.optional(),
    en: Language.optional(),
    meta: z.object({
      pageType: z.string().nullable(),
      pageMetadata: z.unknown().nullable(),
      visibility: z.enum(["restricted", "unlisted", "public", "organizer", "member"]),
      generalRole: z.enum(["viewer", "commenter", "editor"]),
      chapterId: z.string().nullable(),
      tags: z.array(z.string().min(1)),
      access: z.array(Access),
      sources: z.array(Source),
      attachments: z.array(Attachment),
    }),
  })
  .refine((page) => page.ja || page.en, { message: "one locale is required" });
const AgentInstructionsUpdate = z.object({
  content: z.string().min(1).max(262144),
  expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const SyncBody = z
  .object({
    operations: z
      .array(
        z.discriminatedUnion("kind", [
          z.object({
            kind: z.literal("upsert"),
            expectedRevision: z.number().int().positive().optional(),
            page: PagePayload,
          }),
          z.object({
            kind: z.literal("archive"),
            id: z.string(),
            expectedRevision: z.number().int().positive(),
          }),
        ]),
      )
      .default([]),
    agentsMd: AgentInstructionsUpdate.optional(),
  })
  .refine((body) => body.operations.length > 0 || body.agentsMd, {
    message: "operations or agentsMd is required",
  });

export type SyncOperation = z.infer<typeof SyncBody>["operations"][number];
export type SyncPagePayload = Extract<SyncOperation, { kind: "upsert" }>["page"];
