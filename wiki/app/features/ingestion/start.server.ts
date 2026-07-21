import { getAgentByName } from "agents";
import type { WikiGenerationAgent } from "../../../workers/generation-agent";

export async function startWikiGeneration(
  env: Env,
  context: ExecutionContext,
  sessionId: string,
  userId: string,
): Promise<void> {
  const agent = await getAgentByName<Env, WikiGenerationAgent>(env.GENERATION_AGENT, sessionId);
  context.waitUntil(agent.startIngestion(sessionId, userId));
}
