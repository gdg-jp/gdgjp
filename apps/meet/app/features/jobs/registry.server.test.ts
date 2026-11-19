import { describe, expect, it, vi } from "vitest";
import { GoogleApiError } from "~/features/google/client.server";
import { GoogleConnectionError } from "~/features/google/token.server";
import {
  type MeetJobHandlerRegistry,
  RATE_LIMIT_RETRY_DELAY_SECONDS,
  dispatchMeetJobMessage,
  processMeetJobBatch,
} from "./registry.server";

function createFakeMessage(body: unknown) {
  return {
    id: "msg-1",
    body,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

function createFakeHandlers(
  overrides: Partial<MeetJobHandlerRegistry> = {},
): MeetJobHandlerRegistry {
  return {
    sync_members: vi.fn().mockResolvedValue(undefined),
    cleanup_meeting: vi.fn().mockResolvedValue(undefined),
    process_artifact: vi.fn().mockResolvedValue(undefined),
    share_artifact: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("dispatchMeetJobMessage / processMeetJobBatch", () => {
  const env = {} as Env;

  it("既知の sync_members メッセージをハンドラへ振り分け、成功時に ack する", async () => {
    const handlers = createFakeHandlers();
    const message = createFakeMessage({ type: "sync_members", meetingId: "mtg-1" });

    await dispatchMeetJobMessage(env, message, undefined, handlers);

    expect(handlers.sync_members).toHaveBeenCalledWith(
      env,
      { type: "sync_members", meetingId: "mtg-1" },
      undefined,
    );
    expect(handlers.cleanup_meeting).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("既知の cleanup_meeting メッセージをハンドラへ振り分け、成功時に ack する", async () => {
    const handlers = createFakeHandlers();
    const message = createFakeMessage({ type: "cleanup_meeting", meetingId: "mtg-2" });

    await dispatchMeetJobMessage(env, message, undefined, handlers);

    expect(handlers.cleanup_meeting).toHaveBeenCalledWith(
      env,
      { type: "cleanup_meeting", meetingId: "mtg-2" },
      undefined,
    );
    expect(handlers.sync_members).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("既知の process_artifact / share_artifact メッセージをハンドラへ振り分け、成功時に ack する", async () => {
    const handlers = createFakeHandlers();
    const processMsg = createFakeMessage({
      type: "process_artifact",
      meetingId: "mtg-1",
      kind: "recording",
      conferenceRecord: "conferenceRecords/conf-1",
      resourceName: "conferenceRecords/conf-1/recordings/rec-1",
    });
    const shareMsg = createFakeMessage({ type: "share_artifact", artifactId: "art-1" });

    await dispatchMeetJobMessage(env, processMsg, undefined, handlers);
    await dispatchMeetJobMessage(env, shareMsg, undefined, handlers);

    expect(handlers.process_artifact).toHaveBeenCalledWith(env, processMsg.body, undefined);
    expect(handlers.share_artifact).toHaveBeenCalledWith(env, shareMsg.body, undefined);
    expect(processMsg.ack).toHaveBeenCalledTimes(1);
    expect(shareMsg.ack).toHaveBeenCalledTimes(1);
  });

  it("未知のメッセージ型や不正な本文は警告ログを出して ack する", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handlers = createFakeHandlers();
    const message = createFakeMessage({ type: "unknown_job", foo: "bar" });

    await dispatchMeetJobMessage(env, message, undefined, handlers);

    expect(handlers.sync_members).not.toHaveBeenCalled();
    expect(handlers.cleanup_meeting).not.toHaveBeenCalled();
    expect(handlers.process_artifact).not.toHaveBeenCalled();
    expect(handlers.share_artifact).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("429 GoogleApiError 発生時は 60 秒遅延付きで retry する", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handlers = createFakeHandlers({
      sync_members: vi.fn().mockRejectedValue(
        new GoogleApiError({
          httpStatus: 429,
          apiStatus: "RESOURCE_EXHAUSTED",
          apiMessage: "Quota exceeded",
        }),
      ),
    });
    const message = createFakeMessage({ type: "sync_members", meetingId: "mtg-1" });

    await dispatchMeetJobMessage(env, message, undefined, handlers);

    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledWith({
      delaySeconds: RATE_LIMIT_RETRY_DELAY_SECONDS,
    });
    errorSpy.mockRestore();
  });

  it("invalid_grant などの例外発生時は retry する", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handlers = createFakeHandlers({
      sync_members: vi
        .fn()
        .mockRejectedValue(new GoogleConnectionError("invalid_grant", "失効しました")),
    });
    const message = createFakeMessage({ type: "sync_members", meetingId: "mtg-1" });

    await processMeetJobBatch(
      { messages: [message] } as unknown as MessageBatch<unknown>,
      env,
      {} as ExecutionContext,
      handlers,
    );

    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledWith();
    errorSpy.mockRestore();
  });
});
