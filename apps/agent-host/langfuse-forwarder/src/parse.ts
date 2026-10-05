/**
 * Maps xangi's observability event log (logs/observability/*.jsonl, produced by
 * ~/proj/xangi/src/observability-logger.ts) into forwardable Langfuse turns.
 *
 * Pure/no I/O and no Langfuse SDK calls on purpose — this is the unit-tested core
 * (see test/parse.test.ts + fixtures/sample-events.jsonl). index.ts is the only
 * place that talks to the network.
 */

/** Must match OBSERVABILITY_SCHEMA_VERSION in xangi's observability-logger.ts. */
export const SUPPORTED_SCHEMA_VERSIONS = new Set([1, 2]);

interface RawEventBase {
  schemaVersion: number;
  type: string;
  turnId?: unknown;
  appSessionId?: unknown;
  createdAt?: unknown;
  eventId?: unknown;
  sequence?: unknown;
  source?: unknown;
}

export interface ToolCall {
  toolCallId: string;
  name: string;
  input: Record<string, unknown>;
  createdAt: string;
  completedAt?: string;
  output?: unknown;
  error?: string;
  rawKind?: string;
  modelCallId?: string;
}

export interface CursorEvent {
  eventId: string;
  name: string;
  payload: Record<string, unknown>;
  createdAt: string;
  modelCallId?: string;
}

/** A turn that has both a turn_start and a turn_end — ready to forward. */
export interface ParsedTurn {
  turnId: string;
  appSessionId: string;
  backend: string;
  model?: string;
  prompt: string;
  turnStartAt: string;
  toolCalls: ToolCall[];
  cursorEvents: CursorEvent[];
  outcome: "complete" | "error" | "cancelled";
  output?: string;
  error?: string;
  turnEndAt: string;
  latencyMs: number;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  /** A valid turn can still have an incomplete capture when one of its records was malformed. */
  captureIncomplete: boolean;
}

/** A turn that has only seen a turn_start so far — still in flight, not forwarded yet. */
export interface PendingTurn {
  turnId: string;
  appSessionId: string;
  turnStartAt: string;
}

export interface QuarantinedLine {
  line: string;
  reason: string;
}

export interface ParseResult {
  turns: ParsedTurn[];
  pending: PendingTurn[];
  quarantined: QuarantinedLine[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function usageFrom(value: unknown): ParsedTurn["usage"] | undefined {
  if (!isRecord(value)) return undefined;
  const input = value.input ?? value.inputTokens;
  const output = value.output ?? value.outputTokens;
  const cacheRead = value.cacheRead ?? value.cacheReadTokens;
  const cacheWrite = value.cacheWrite ?? value.cacheWriteTokens;
  const usage = {
    input: typeof input === "number" ? input : undefined,
    output: typeof output === "number" ? output : undefined,
    cacheRead: typeof cacheRead === "number" ? cacheRead : undefined,
    cacheWrite: typeof cacheWrite === "number" ? cacheWrite : undefined,
  };
  return Object.values(usage).some((item) => item !== undefined) ? usage : undefined;
}

interface TurnAccumulator {
  turnId: string;
  appSessionId: string;
  backend?: string;
  model?: string;
  prompt?: string;
  turnStartAt?: string;
  toolCalls: ToolCall[];
  cursorEvents: CursorEvent[];
  outcome?: "complete" | "error" | "cancelled";
  output?: string;
  error?: string;
  turnEndAt?: string;
  latencyMs?: number;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  captureIncomplete: boolean;
}

/**
 * Parses one session's raw JSONL lines into forwardable turns.
 *
 * Validation policy: a line that fails to parse as JSON, carries an unsupported
 * schemaVersion, or fails per-type shape validation is quarantined rather than
 * silently dropped — every run re-surfaces it until the underlying issue (a
 * xangi schema change, or truncated write) is fixed. See docs/agents-local-o11y
 * plan's "Unknown/malformed records" section for why this matters: this consumer
 * has no byte-offset watermark to accidentally skip past, so a quarantined line
 * simply never becomes part of a forwarded turn — nothing to "advance past".
 */
export function parseSessionEvents(appSessionId: string, lines: string[]): ParseResult {
  const quarantined: QuarantinedLine[] = [];
  const turnsById = new Map<string, TurnAccumulator>();
  const turnOrder: string[] = [];
  // turnIds discarded by an unknown event type (see the `default` case below).
  // Kept separate from turnOrder so a later valid event for a DIFFERENT turnId
  // is never mistaken for this one — turnOrder itself is never mutated after a
  // push, only ever filtered by "does turnsById still have this id" at the end.
  const discardedTurnIds = new Set<string>();

  const getAccumulator = (turnId: string): TurnAccumulator => {
    let acc = turnsById.get(turnId);
    if (!acc) {
      acc = {
        turnId,
        appSessionId,
        toolCalls: [],
        cursorEvents: [],
        captureIncomplete: false,
      };
      turnsById.set(turnId, acc);
      turnOrder.push(turnId);
    }
    return acc;
  };

  for (const line of lines) {
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch (err) {
      quarantined.push({
        line,
        reason: `invalid JSON: ${(err as Error).message}`,
      });
      continue;
    }

    if (
      !isRecord(json) ||
      typeof json.type !== "string" ||
      typeof json.schemaVersion !== "number"
    ) {
      quarantined.push({ line, reason: "missing type or schemaVersion" });
      continue;
    }
    const event = json as unknown as RawEventBase;
    if (!SUPPORTED_SCHEMA_VERSIONS.has(event.schemaVersion)) {
      quarantined.push({
        line,
        reason: `unsupported schemaVersion ${event.schemaVersion}`,
      });
      continue;
    }
    if (!isNonEmptyString(event.turnId) || !isNonEmptyString(event.createdAt)) {
      quarantined.push({ line, reason: "missing turnId or createdAt" });
      continue;
    }
    if (
      event.schemaVersion === 2 &&
      (!isNonEmptyString(event.eventId) ||
        !Number.isInteger(event.sequence) ||
        (event.source !== "cursor" && event.source !== "xangi"))
    ) {
      quarantined.push({ line, reason: "v2 event missing eventId, sequence, or valid source" });
      continue;
    }
    if (event.appSessionId !== undefined && event.appSessionId !== appSessionId) {
      quarantined.push({
        line,
        reason: "appSessionId does not match the file it was read from",
      });
      continue;
    }
    if (discardedTurnIds.has(event.turnId)) {
      quarantined.push({
        line,
        reason: `turnId ${event.turnId} was already discarded by an earlier unknown event type`,
      });
      continue;
    }

    const raw = json as Record<string, unknown>;
    const acc = getAccumulator(event.turnId);

    switch (event.type) {
      case "turn_start": {
        if (!isNonEmptyString(raw.backend) || !isNonEmptyString(raw.prompt)) {
          quarantined.push({
            line,
            reason: "turn_start missing backend or prompt",
          });
          continue;
        }
        acc.backend = raw.backend;
        acc.model = isNonEmptyString(raw.model) ? raw.model : undefined;
        acc.prompt = raw.prompt;
        acc.turnStartAt = event.createdAt;
        break;
      }
      case "tool_call_start": {
        if (
          !isNonEmptyString(raw.toolCallId) ||
          !isNonEmptyString(raw.name) ||
          !isRecord(raw.input)
        ) {
          quarantined.push({
            line,
            reason: "tool_call_start missing toolCallId, name, or input",
          });
          acc.captureIncomplete = true;
          continue;
        }
        acc.toolCalls.push({
          toolCallId: raw.toolCallId,
          name: raw.name,
          input: raw.input,
          createdAt: event.createdAt,
          rawKind: isNonEmptyString(raw.rawKind) ? raw.rawKind : undefined,
          modelCallId: isNonEmptyString(raw.modelCallId) ? raw.modelCallId : undefined,
        });
        break;
      }
      case "tool_call_end": {
        if (!isNonEmptyString(raw.toolCallId)) {
          quarantined.push({
            line,
            reason: "tool_call_end missing toolCallId",
          });
          acc.captureIncomplete = true;
          continue;
        }
        const call = acc.toolCalls.find((item) => item.toolCallId === raw.toolCallId);
        if (call) {
          call.completedAt = event.createdAt;
          call.output = raw.output;
          call.error = isNonEmptyString(raw.error) ? raw.error : undefined;
          call.modelCallId = isNonEmptyString(raw.modelCallId) ? raw.modelCallId : call.modelCallId;
        } else {
          acc.toolCalls.push({
            toolCallId: raw.toolCallId,
            name: isNonEmptyString(raw.name) ? raw.name : "tool",
            input: isRecord(raw.input) ? raw.input : {},
            createdAt: event.createdAt,
            completedAt: event.createdAt,
            output: raw.output,
            error: isNonEmptyString(raw.error) ? raw.error : undefined,
          });
        }
        break;
      }
      case "cursor_event": {
        if (!isNonEmptyString(raw.name) || !isRecord(raw.payload)) {
          quarantined.push({
            line,
            reason: "cursor_event missing name or payload",
          });
          acc.captureIncomplete = true;
          continue;
        }
        acc.cursorEvents.push({
          eventId: isNonEmptyString(raw.eventId)
            ? raw.eventId
            : `${event.turnId}:${acc.cursorEvents.length}`,
          name: raw.name,
          payload: raw.payload,
          createdAt: event.createdAt,
          modelCallId: isNonEmptyString(raw.modelCallId) ? raw.modelCallId : undefined,
        });
        if (raw.name === "result") acc.usage = usageFrom(raw.payload.usage) ?? acc.usage;
        break;
      }
      case "turn_end": {
        if (
          (raw.outcome !== "complete" && raw.outcome !== "error" && raw.outcome !== "cancelled") ||
          typeof raw.latencyMs !== "number"
        ) {
          quarantined.push({
            line,
            reason: "turn_end missing/invalid outcome or latencyMs",
          });
          acc.captureIncomplete = true;
          continue;
        }
        acc.outcome = raw.outcome;
        acc.output = isNonEmptyString(raw.output) ? raw.output : undefined;
        acc.error = isNonEmptyString(raw.error) ? raw.error : undefined;
        acc.turnEndAt = event.createdAt;
        acc.latencyMs = raw.latencyMs;
        acc.usage = usageFrom(raw.usage) ?? acc.usage;
        break;
      }
      default:
        // Discard only this turnId's accumulated data — NOT turnOrder.pop(), which
        // removes whatever turnId was pushed last, regardless of which turnId this
        // unknown event actually belongs to. A real repro: turn_start(t1),
        // turn_start(t2), then an unknown event for t1 — pop() silently dropped
        // t2's already-valid, already-complete turn from the output.
        quarantined.push({
          line,
          reason: `unknown event type "${event.type}"`,
        });
        turnsById.delete(event.turnId);
        discardedTurnIds.add(event.turnId);
        continue;
    }
  }

  const turns: ParsedTurn[] = [];
  const pending: PendingTurn[] = [];
  for (const turnId of turnOrder) {
    const acc = turnsById.get(turnId);
    if (!acc || !acc.turnStartAt || !acc.backend || acc.prompt === undefined) {
      // turn_end (or a tool_call) arrived without ever seeing a turn_start for
      // this turnId — can happen if turn_start itself was quarantined. Nothing
      // sane to forward.
      continue;
    }
    if (acc.turnEndAt && acc.outcome) {
      turns.push({
        turnId: acc.turnId,
        appSessionId: acc.appSessionId,
        backend: acc.backend,
        model: acc.model,
        prompt: acc.prompt,
        turnStartAt: acc.turnStartAt,
        toolCalls: acc.toolCalls,
        cursorEvents: acc.cursorEvents,
        outcome: acc.outcome,
        output: acc.output,
        error: acc.error,
        turnEndAt: acc.turnEndAt,
        latencyMs: acc.latencyMs ?? 0,
        usage: acc.usage,
        captureIncomplete: acc.captureIncomplete,
      });
    } else {
      pending.push({
        turnId: acc.turnId,
        appSessionId: acc.appSessionId,
        turnStartAt: acc.turnStartAt,
      });
    }
  }

  return { turns, pending, quarantined };
}
