/** Langfuse observation types emitted by the forwarder. */
export type ObservationType =
  | "agent"
  | "generation"
  | "tool"
  | "retriever"
  | "guardrail"
  | "span"
  | "event"
  | "evaluator";

/**
 * Classifies by the actual operation, not only Cursor's coarse tool name.
 * Cursor reports `wk ls pages/` through `Shell`, but it is ACL-mediated
 * navigation and belongs in RETRIEVER.
 */
export function classifyTool(name: string, input: Record<string, unknown>): ObservationType {
  const command = typeof input.command === "string" ? input.command.trim() : "";
  if (/^(?:\/opt\/gdg-agent\/bin\/)?wk\s+(?:ls|read|grep|search)\b/.test(command)) {
    return "retriever";
  }

  const normalized = name.toLowerCase();
  if (/^(read|grep|glob|list|search|semantic|lsp)|wk_(search|cat)/.test(normalized)) {
    return "retriever";
  }
  if (/(acl|permission|policy|authz|guard)/.test(normalized)) return "guardrail";
  return "tool";
}
