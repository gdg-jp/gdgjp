import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { propagateAttributes, startObservation } from "@langfuse/tracing";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { type ObservationType, classifyTool } from "./classify.js";
import { type ForwarderConfig, loadConfig } from "./config.js";
import { deterministicIdGenerator, withDeterministicIds } from "./deterministic-ids.js";
import { discoverSessionLogs, readEventLines } from "./events.js";
import { hashId, maskEventData } from "./mask.js";
import { type ParsedTurn, type QuarantinedLine, parseSessionEvents } from "./parse.js";
import { type ForwarderState, isForwarded, loadState, markForwarded, saveState } from "./state.js";

/** Langfuse ObservationLevel for a turn's outcome. */
function levelForOutcome(outcome: ParsedTurn["outcome"]): "DEFAULT" | "WARNING" | "ERROR" {
  if (outcome === "error") return "ERROR";
  if (outcome === "cancelled") return "WARNING";
  return "DEFAULT";
}

function writeQuarantine(stateDir: string, appSessionId: string, lines: QuarantinedLine[]): void {
  if (lines.length === 0) return;
  const dir = join(stateDir, "quarantine");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${appSessionId}.jsonl`);
  const payload = lines.map((q) =>
    JSON.stringify({ ...q, quarantinedAt: new Date().toISOString() }),
  );
  appendFileSync(path, `${payload.join("\n")}\n`, { mode: 0o600 });
}

/**
 * Creates one Langfuse trace for a turn: a root `agent` observation named after
 * the backend, with each tool call as a sibling `tool` observation underneath it
 * (never nested under a synthetic generation — see docs/agents-local-o11y plan's
 * "Trace/observation model"). This is backfilling historical data (the turn
 * already fully happened), so every observation is created with its real
 * startTime/endTime instead of wall-clock "now".
 */
function digestTurn(turn: ParsedTurn): string {
  // The append-only source can receive late events after turn_end. A digest of
  // the complete parsed turn causes a deterministic Langfuse upsert, not a skip.
  return createHash("sha256").update(JSON.stringify(turn)).digest("hex");
}

function observationTypeForEvent(name: string): ObservationType {
  if (name === "thinking") return "span";
  if (name === "approval" || name === "acl_decision") return "guardrail";
  return "event";
}

function forwardTurn(turn: ParsedTurn, idSalt: string): Promise<void> {
  const hashedId = hashId(turn.appSessionId, idSalt);
  return propagateAttributes(
    { userId: hashedId, sessionId: hashedId, tags: [turn.backend] },
    async () => {
      // Deterministic ids (see deterministic-ids.ts) are what makes re-running
      // the forwarder against an already-forwarded turn a true no-op on the
      // Langfuse side instead of creating a duplicate trace.
      const root = withDeterministicIds(turn.turnId, () =>
        startObservation(
          turn.backend,
          {
            input: turn.prompt,
            output: turn.outcome === "complete" ? turn.output : undefined,
            level: turn.captureIncomplete ? "WARNING" : levelForOutcome(turn.outcome),
            statusMessage: turn.error,
            metadata: {
              turnId: turn.turnId,
              backend: turn.backend,
              captureIncomplete: turn.captureIncomplete,
              ...(turn.model ? { model: turn.model } : {}),
              ...(turn.usage ? { usage: turn.usage } : {}),
            },
          },
          { asType: "agent", startTime: new Date(turn.turnStartAt) },
        ),
      );

      // root.startObservation(...) (the child-creation convenience method) does
      // not accept a custom startTime — only the top-level startObservation()
      // function does. So tool spans are created via the top-level function with
      // an explicit parentSpanContext pointing at root, which still makes them
      // children of root (siblings of each other), just via the more verbose API.
      const parentSpanContext = {
        traceId: root.traceId,
        spanId: root.id,
        traceFlags: 1,
      };
      for (const call of turn.toolCalls) {
        const child = withDeterministicIds(`${turn.turnId}:${call.toolCallId}`, () =>
          startObservation(
            call.name,
            {
              input: call.input,
              output: call.output,
              statusMessage: call.error,
              level: call.error ? "ERROR" : "DEFAULT",
              metadata: {
                toolCallId: call.toolCallId,
                ...(call.rawKind ? { rawKind: call.rawKind } : {}),
              },
            },
            // Langfuse's overloads require a literal even though every listed
            // value is a supported runtime observation type.
            {
              asType: classifyTool(call.name, call.input) as never,
              startTime: new Date(call.createdAt),
              parentSpanContext,
            },
          ),
        );
        child.end(new Date(call.completedAt ?? call.createdAt));
      }

      // Cursor doesn't expose the complete provider request. Model-call output is
      // still useful, as long as its incompleteness is explicit and usage remains
      // on the turn (never guessed per call).
      const byModelCall = new Map<string, typeof turn.cursorEvents>();
      for (const event of turn.cursorEvents) {
        if (!event.modelCallId || !["assistant_message", "thinking"].includes(event.name)) continue;
        const events = byModelCall.get(event.modelCallId) ?? [];
        events.push(event);
        byModelCall.set(event.modelCallId, events);
      }
      for (const [modelCallId, events] of byModelCall) {
        const child = withDeterministicIds(`${turn.turnId}:generation:${modelCallId}`, () =>
          startObservation(
            "cursor-model-call",
            {
              input: { completeness: "unavailable" },
              output: {
                completeness: "partial",
                events: events.map((event) => event.payload),
              },
              metadata: { modelCallId, captureCoverage: "stream-partial" },
            },
            {
              asType: "generation",
              startTime: new Date(events[0].createdAt),
              parentSpanContext,
            },
          ),
        );
        child.end(new Date(events.at(-1)?.createdAt ?? events[0].createdAt));
      }

      for (const event of turn.cursorEvents) {
        // assistant/thinking with a model call are represented by the partial
        // generation above; do not double-count them as unrelated events.
        if (event.modelCallId && ["assistant_message", "thinking"].includes(event.name)) continue;
        const child = withDeterministicIds(`${turn.turnId}:event:${event.eventId}`, () =>
          startObservation(
            event.name,
            {
              input: event.payload,
              metadata: {
                eventId: event.eventId,
                ...(event.modelCallId ? { modelCallId: event.modelCallId } : {}),
              },
            },
            {
              asType: observationTypeForEvent(event.name) as never,
              startTime: new Date(event.createdAt),
              parentSpanContext,
            },
          ),
        );
        child.end(new Date(event.createdAt));
      }

      root.end(new Date(turn.turnEndAt));
    },
  );
}

async function run(config: ForwarderConfig, spanProcessor: LangfuseSpanProcessor): Promise<void> {
  const state = loadState(config.stateDir);
  const sessions = discoverSessionLogs(config.dataDir);

  const forwardedThisRun: Array<{
    appSessionId: string;
    turnId: string;
    digest: string;
  }> = [];
  let quarantineCount = 0;
  let pendingCount = 0;

  for (const session of sessions) {
    const lines = readEventLines(session.filePath);
    const { turns, pending, quarantined } = parseSessionEvents(session.appSessionId, lines);

    if (quarantined.length > 0) {
      quarantineCount += quarantined.length;
      writeQuarantine(config.stateDir, session.appSessionId, quarantined);
    }
    pendingCount += pending.length;

    for (const turn of turns) {
      const digest = digestTurn(turn);
      if (isForwarded(state, turn.appSessionId, turn.turnId, digest)) continue;
      await forwardTurn(turn, config.idSalt);
      forwardedThisRun.push({
        appSessionId: turn.appSessionId,
        turnId: turn.turnId,
        digest,
      });
    }
  }

  if (forwardedThisRun.length === 0) {
    console.log(
      `[langfuse-forwarder] Nothing new to forward (${sessions.length} sessions, ${pendingCount} turns still in flight, ${quarantineCount} quarantined lines).`,
    );
    return;
  }

  // Only mark state after a confirmed flush — a failed flush must retry next
  // run rather than silently drop the turn (see plan's "Idempotent forwarding").
  await spanProcessor.forceFlush();

  for (const { appSessionId, turnId, digest } of forwardedThisRun) {
    markForwarded(state, appSessionId, turnId, digest);
  }
  saveState(config.stateDir, state);

  console.log(
    `[langfuse-forwarder] Forwarded ${forwardedThisRun.length} turn(s) across ${sessions.length} session(s). ` +
      `${pendingCount} still in flight, ${quarantineCount} quarantined lines this run.`,
  );
}

async function main(): Promise<void> {
  const config = loadConfig();
  // Configured secrets this process actually knows about, for exact-match
  // masking — see mask.ts's doc comment on why this can't default to
  // process.env (LANGFUSE_SECRET_KEY only ever exists in the credentials file
  // for this unit, never as an environment variable).
  const configuredSecrets = [config.LANGFUSE_SECRET_KEY];

  const spanProcessor = new LangfuseSpanProcessor({
    publicKey: config.LANGFUSE_PUBLIC_KEY,
    secretKey: config.LANGFUSE_SECRET_KEY,
    baseUrl: config.LANGFUSE_HOST,
    mask: ({ data }) => maskEventData(data, configuredSecrets),
    environment: process.env.LANGFUSE_TRACING_ENVIRONMENT || "production",
    release: process.env.GDG_AGENT_RELEASE,
  });
  const sdk = new NodeSDK({
    idGenerator: deterministicIdGenerator,
    spanProcessors: [spanProcessor],
  });
  sdk.start();

  try {
    await run(config, spanProcessor);
  } finally {
    await spanProcessor.forceFlush();
    await sdk.shutdown();
  }
}

main().catch((err) => {
  console.error("[langfuse-forwarder] Fatal error:", err);
  process.exitCode = 1;
});
