import { diffChars } from "diff";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { useCallback, useEffect, useRef, useState } from "react";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { hashColorHex } from "~/lib/color-utils";
import { setCursors, subscribeLocalCursor } from "~/lib/remote-cursors-store";

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

export interface CollabUser {
  id: string;
  name: string;
  image: string | null;
}

export interface CollabPeer {
  clientId: number;
  user: CollabUser;
  activeLang: "ja" | "en";
}

interface UseCollabEditorOptions {
  slug: string;
  initialContentJa: string;
  initialContentEn: string;
  user: CollabUser;
}

interface UseCollabEditorReturn {
  contentJa: string;
  contentEn: string;
  setContentJa: (value: string) => void;
  setContentEn: (value: string) => void;
  peers: CollabPeer[];
  connected: boolean;
  setActiveLang: (lang: "ja" | "en") => void;
}

interface CursorAwarenessState {
  ja?: unknown;
  en?: unknown;
}

/**
 * Apply a new string value to a Y.Text by computing a character-level diff
 * and applying insert/delete operations.
 */
function applyStringToYText(ytext: Y.Text, newValue: string): void {
  const currentValue = ytext.toString();
  if (currentValue === newValue) return;

  const changes = diffChars(currentValue, newValue);
  ytext.doc?.transact(() => {
    let pos = 0;
    for (const change of changes) {
      if (change.removed) {
        ytext.delete(pos, change.value.length);
      } else if (change.added) {
        ytext.insert(pos, change.value);
        pos += change.value.length;
      } else {
        pos += change.value.length;
      }
    }
  });
}

function encodeRelativeCursor(ytext: Y.Text, pos: number): unknown {
  const clamped = Math.max(0, Math.min(pos, ytext.length));
  return Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, clamped));
}

function decodeRelativeCursor(cursor: unknown, ydoc: Y.Doc): number | null {
  if (!cursor || typeof cursor !== "object") return null;
  try {
    const relPos = Y.createRelativePositionFromJSON(cursor);
    const absPos = Y.createAbsolutePositionFromRelativePosition(relPos, ydoc);
    return absPos ? absPos.index : null;
  } catch {
    return null;
  }
}

export function useCollabEditor({
  slug,
  initialContentJa,
  initialContentEn,
  user,
}: UseCollabEditorOptions): UseCollabEditorReturn {
  const [contentJa, setContentJaState] = useState(initialContentJa);
  const [contentEn, setContentEnState] = useState(initialContentEn);
  const [peers, setPeers] = useState<CollabPeer[]>([]);
  const [connected, setConnected] = useState(false);

  const ydocRef = useRef<Y.Doc | null>(null);
  const awarenessRef = useRef<awarenessProtocol.Awareness | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isRemoteUpdate = useRef(false);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeLangRef = useRef<"ja" | "en">("ja");
  const mountedRef = useRef(true);
  const hasReceivedInitialSyncRef = useRef(false);
  const pendingContentJaRef = useRef<string | null>(null);
  const pendingContentEnRef = useRef<string | null>(null);

  // Update awareness when active language changes
  const setActiveLang = useCallback((lang: "ja" | "en") => {
    activeLangRef.current = lang;
    if (awarenessRef.current) {
      awarenessRef.current.setLocalStateField("activeLang", lang);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let disposed = false;
    const ydoc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(ydoc);
    ydocRef.current = ydoc;
    awarenessRef.current = awareness;

    const textJa = ydoc.getText("contentJa");
    const textEn = ydoc.getText("contentEn");

    // Observe Y.Text changes and update React state
    const observerJa = () => {
      if (!mountedRef.current) return;
      const value = textJa.toString();
      isRemoteUpdate.current = true;
      setContentJaState((prev) => (prev === value ? prev : value));
      isRemoteUpdate.current = false;
      // Relative cursor positions must be re-resolved whenever document text changes.
      awarenessHandler();
    };
    const observerEn = () => {
      if (!mountedRef.current) return;
      const value = textEn.toString();
      isRemoteUpdate.current = true;
      setContentEnState((prev) => (prev === value ? prev : value));
      isRemoteUpdate.current = false;
      // Relative cursor positions must be re-resolved whenever document text changes.
      awarenessHandler();
    };
    textJa.observe(observerJa);
    textEn.observe(observerEn);

    // Observe awareness changes — update peers list AND remote cursor store
    const awarenessHandler = () => {
      if (!mountedRef.current) return;
      const states = awareness.getStates();
      const newPeers: CollabPeer[] = [];
      const remoteCursorsJa: {
        clientId: number;
        userName: string;
        color: string;
        cursorPos: number;
        activeLang: "ja" | "en";
      }[] = [];
      const remoteCursorsEn: {
        clientId: number;
        userName: string;
        color: string;
        cursorPos: number;
        activeLang: "ja" | "en";
      }[] = [];
      for (const [clientId, state] of states) {
        if (clientId === ydoc.clientID) continue;
        if (state.user) {
          const activeLang = (state.activeLang as "ja" | "en") ?? "ja";
          const cursor = (state.cursor as CursorAwarenessState | undefined) ?? {};
          const jaPos = decodeRelativeCursor(cursor.ja, ydoc);
          const enPos = decodeRelativeCursor(cursor.en, ydoc);
          const userId = (state.user as CollabUser).id;
          const color = hashColorHex(userId);
          const peer = {
            clientId,
            user: state.user as CollabUser,
            activeLang,
          };
          newPeers.push(peer);
          if (jaPos !== null) {
            remoteCursorsJa.push({
              clientId,
              userName: peer.user.name,
              color,
              cursorPos: jaPos,
              activeLang,
            });
          }
          if (enPos !== null) {
            remoteCursorsEn.push({
              clientId,
              userName: peer.user.name,
              color,
              cursorPos: enPos,
              activeLang,
            });
          }
        }
      }
      setPeers(newPeers);
      setCursors("editor-ja", remoteCursorsJa);
      setCursors("editor-en", remoteCursorsEn);
    };
    awareness.on("change", awarenessHandler);

    // Subscribe to local cursor changes from CM6 editors → broadcast via awareness
    const unsubJa = subscribeLocalCursor("editor-ja", (pos) => {
      const current = (awareness.getLocalState()?.cursor as CursorAwarenessState | undefined) ?? {};
      awareness.setLocalStateField("cursor", {
        ...current,
        ja: encodeRelativeCursor(textJa, pos),
      });
    });
    const unsubEn = subscribeLocalCursor("editor-en", (pos) => {
      const current = (awareness.getLocalState()?.cursor as CursorAwarenessState | undefined) ?? {};
      awareness.setLocalStateField("cursor", {
        ...current,
        en: encodeRelativeCursor(textEn, pos),
      });
    });

    // Send outgoing Y.Doc updates to server (registered once, not per-connect)
    const sendUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === "remote") return;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      ws.send(encoding.toUint8Array(encoder));
    };
    ydoc.on("update", sendUpdate);

    // Send local awareness updates to server so remote peers receive them
    const sendAwarenessUpdate = (
      { added, updated }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      if (origin === "remote") return;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const changedClients = added.concat(updated);
      if (changedClients.length === 0) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients),
      );
      ws.send(encoding.toUint8Array(encoder));
    };
    awareness.on("update", sendAwarenessUpdate);

    function connect() {
      if (disposed) return;
      hasReceivedInitialSyncRef.current = false;
      pendingContentJaRef.current = null;
      pendingContentEnRef.current = null;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/collab/${slug}`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        if (disposed) {
          ws.close(1000, "stale-connection");
          return;
        }
        if (!mountedRef.current) return;
        setConnected(true);
        reconnectAttempt.current = 0;

        // Server sends initial sync state on connect.
        // Set awareness local state
        awareness.setLocalState({
          user: { id: user.id, name: user.name, image: user.image },
          activeLang: activeLangRef.current,
        });
      });

      ws.addEventListener("message", (event) => {
        if (disposed) return;
        if (typeof event.data === "string") return;
        const data = new Uint8Array(event.data as ArrayBuffer);
        const decoder = decoding.createDecoder(data);
        const messageType = decoding.readVarUint(decoder);

        switch (messageType) {
          case MSG_SYNC: {
            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, MSG_SYNC);
            syncProtocol.readSyncMessage(decoder, encoder, ydoc, "remote");
            if (!hasReceivedInitialSyncRef.current) {
              hasReceivedInitialSyncRef.current = true;
              const queuedJa = pendingContentJaRef.current;
              const queuedEn = pendingContentEnRef.current;
              pendingContentJaRef.current = null;
              pendingContentEnRef.current = null;
              if (queuedJa !== null) {
                applyStringToYText(ydoc.getText("contentJa"), queuedJa);
              }
              if (queuedEn !== null) {
                applyStringToYText(ydoc.getText("contentEn"), queuedEn);
              }
            }
            if (encoding.length(encoder) > 1) {
              ws.send(encoding.toUint8Array(encoder));
            }
            break;
          }
          case MSG_AWARENESS: {
            const update = decoding.readVarUint8Array(decoder);
            awarenessProtocol.applyAwarenessUpdate(awareness, update, "remote");
            break;
          }
        }
      });

      ws.addEventListener("close", () => {
        if (disposed) return;
        if (!mountedRef.current) return;
        setConnected(false);
        if (wsRef.current === ws) {
          wsRef.current = null;
        }

        // Reconnect with exponential backoff
        const delay = Math.min(1000 * 2 ** reconnectAttempt.current, 30_000);
        reconnectAttempt.current++;
        reconnectTimer.current = setTimeout(connect, delay);
      });

      ws.addEventListener("error", () => {});
    }

    connect();

    return () => {
      disposed = true;
      mountedRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      unsubJa();
      unsubEn();
      setCursors("editor-ja", []);
      setCursors("editor-en", []);
      textJa.unobserve(observerJa);
      textEn.unobserve(observerEn);
      awareness.off("change", awarenessHandler);
      awareness.off("update", sendAwarenessUpdate);
      ydoc.off("update", sendUpdate);
      awareness.destroy();
      ydoc.destroy();
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close(1000, "component-unmount");
      }
      ydocRef.current = null;
      awarenessRef.current = null;
    };
  }, [slug, user.id, user.name, user.image]);

  // Editor → CRDT: apply string diff when content changes from local edits
  const setContentJa = useCallback((value: string) => {
    if (isRemoteUpdate.current) return;
    if (!hasReceivedInitialSyncRef.current) {
      pendingContentJaRef.current = value;
      setContentJaState((prev) => (prev === value ? prev : value));
      return;
    }
    const ydoc = ydocRef.current;
    if (!ydoc) {
      setContentJaState(value);
      return;
    }
    applyStringToYText(ydoc.getText("contentJa"), value);
  }, []);

  const setContentEn = useCallback((value: string) => {
    if (isRemoteUpdate.current) return;
    if (!hasReceivedInitialSyncRef.current) {
      pendingContentEnRef.current = value;
      setContentEnState((prev) => (prev === value ? prev : value));
      return;
    }
    const ydoc = ydocRef.current;
    if (!ydoc) {
      setContentEnState(value);
      return;
    }
    applyStringToYText(ydoc.getText("contentEn"), value);
  }, []);

  return { contentJa, contentEn, setContentJa, setContentEn, peers, connected, setActiveLang };
}
