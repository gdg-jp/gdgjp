import { useAgent } from "agents/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IngestionAgentStateWire } from "../../../shared/ingestion/agent-state";
import type { ChangesetOperation } from "../../../shared/ingestion/domain";
import {
  type IngestionRealtimeEvent,
  parseIngestionRealtimeEvent,
  realtimeEventKey,
} from "../../../shared/ingestion/realtime-events";
import { createIngestionAgentClient } from "./agent-client";

const MAX_RECENT_EVENTS = 24;
const MAX_DEDUPLICATION_KEYS = 128;

function decodeEvent(data: unknown): IngestionRealtimeEvent | null {
  if (typeof data !== "string") return null;
  try {
    return parseIngestionRealtimeEvent(JSON.parse(data));
  } catch {
    return null;
  }
}

/**
 * Connects a session-specific Agent and maintains a bounded, de-duplicated
 * display-safe execution feed. Durable screen data still comes from the route loader.
 */
export function useIngestionAgent(sessionId: string) {
  const seenEventKeys = useRef(new Set<string>());
  const [events, setEvents] = useState<IngestionRealtimeEvent[]>([]);

  const onMessage = useCallback((message: MessageEvent) => {
    const event = decodeEvent(message.data);
    if (!event) return;

    const key = realtimeEventKey(event);
    if (key) {
      if (seenEventKeys.current.has(key)) return;
      seenEventKeys.current.add(key);
      if (seenEventKeys.current.size > MAX_DEDUPLICATION_KEYS) {
        const oldestKey = seenEventKeys.current.values().next().value;
        if (oldestKey) seenEventKeys.current.delete(oldestKey);
      }
    }

    setEvents((previous) => [...previous.slice(-(MAX_RECENT_EVENTS - 1)), event]);
  }, []);

  const agent = useAgent<IngestionAgentStateWire>({
    agent: "WikiGenerationAgent",
    name: sessionId,
    onMessage,
  });

  useEffect(() => {
    void sessionId;
    seenEventKeys.current.clear();
    setEvents([]);
  }, [sessionId]);

  const client = useMemo(
    () =>
      createIngestionAgentClient<ChangesetOperation>(
        (method, args) => agent.call(method, args) as Promise<never>,
      ),
    [agent.call],
  );

  return { agent, client, events };
}
