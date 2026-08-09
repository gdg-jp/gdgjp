import { AsyncLocalStorage } from "node:async_hooks";

export type AgentRequestContext = {
  /** Verified webhook message id (Google Chat jti / Discord interaction id). */
  messageId?: string;
};

const storage = new AsyncLocalStorage<AgentRequestContext>();

export function runWithAgentRequestContext<T>(context: AgentRequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getAgentRequestContext(): AgentRequestContext | undefined {
  return storage.getStore();
}

export function getVerifiedMessageId(): string | undefined {
  const id = storage.getStore()?.messageId;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}
