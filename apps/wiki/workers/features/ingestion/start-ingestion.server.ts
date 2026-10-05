import { getAgentByName } from "agents";
import type { AccessContext } from "../../../shared/ingestion/domain";
import type { WikiGenerationAgent } from "../../agents/wiki-generation-agent";
import { D1IngestionSessionRepository } from "./persistence/d1/ingestion-session-repository";

export interface PendingIngestionFile {
  buffer: ArrayBuffer;
  mimeType: string;
  name: string;
}

export interface StartIngestionInput {
  sessionId: string;
  userId: string;
  access: AccessContext;
  texts: string[];
  googleDocUrls: string[];
  googleFormUrl?: string;
  eventTitle?: string;
  images: PendingIngestionFile[];
  pdfs: PendingIngestionFile[];
}

function uploadKey(userId: string, sessionId: string, name: string): string {
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "upload";
  return `ingestion/${userId}/${sessionId}/${crypto.randomUUID()}-${safeName}`;
}

/** Worker-owned start facade. No binary data is placed in Agent state or Workflow params. */
export async function createAndStartIngestion(
  env: Env,
  context: ExecutionContext,
  input: StartIngestionInput,
): Promise<{ sessionId: string }> {
  const sessions = new D1IngestionSessionRepository(env.DB);
  const imageKeys = input.images.map((file) => uploadKey(input.userId, input.sessionId, file.name));
  const pdfKeys = input.pdfs.map((file) => uploadKey(input.userId, input.sessionId, file.name));
  await sessions.create({
    id: input.sessionId,
    userId: input.userId,
    status: "processing",
    accessContext: input.access,
    inputs: {
      texts: input.texts,
      imageKeys,
      googleDocUrls: input.googleDocUrls,
      pdfKeys,
      googleFormUrl: input.googleFormUrl,
      eventTitle: input.eventTitle,
    },
  });
  try {
    await Promise.all([
      ...input.images.map((file, index) =>
        env.BUCKET.put(imageKeys[index], file.buffer, {
          httpMetadata: { contentType: file.mimeType || "application/octet-stream" },
        }),
      ),
      ...input.pdfs.map((file, index) =>
        env.BUCKET.put(pdfKeys[index], file.buffer, {
          httpMetadata: { contentType: "application/pdf" },
        }),
      ),
    ]);
  } catch (error) {
    await Promise.allSettled([...imageKeys, ...pdfKeys].map((key) => env.BUCKET.delete(key)));
    await sessions.transition(input.sessionId, ["processing"], "error", {
      phaseMessage: null,
      errorMessage: "Failed to store ingestion attachments.",
    });
    throw error;
  }

  let agent: DurableObjectStub<WikiGenerationAgent>;
  try {
    agent = await getAgentByName<Env, WikiGenerationAgent>(
      env.WikiGenerationAgent,
      input.sessionId,
    );
  } catch (error) {
    await sessions.transition(input.sessionId, ["processing"], "error", {
      phaseMessage: null,
      errorMessage: "Unable to connect to the ingestion agent.",
    });
    throw error;
  }
  context.waitUntil(
    agent.startIngestion({ sessionId: input.sessionId }).catch(async (error) => {
      console.error(
        JSON.stringify({
          component: "wiki-generation-agent",
          event: "workflow_start_failed",
          sessionId: input.sessionId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      await sessions.transition(input.sessionId, ["processing"], "error", {
        phaseMessage: null,
        errorMessage: "Unable to start ingestion.",
      });
    }),
  );
  return { sessionId: input.sessionId };
}
