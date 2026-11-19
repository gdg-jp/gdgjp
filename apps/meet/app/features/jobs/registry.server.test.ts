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

describe("dispatchMeetJobMessage / processMeetJobBatch", () => {
  const env = {} as Env;

  it("既知の sync_members メッセージをハンドラへ振り分け、成功時に ack する", async () => {
    const syncHandler = vi.fn().mockResolvedValue(undefined);
    const handlers: MeetJobHandlerRegistry = { sync_members: syncHandler };
    const message = createFakeMessage({ type: "sync_members", meetingId: "mtg-1" });

    await dispatchMeetJobMessage(env, message, undefined, handlers);

    expect(syncHandler).toHaveBeenCalledWith(
      env,
      { type: "sync_members", meetingId: "mtg-1" },
      undefined,
    );
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("未知のメッセージ型や不正な本文は警告ログを出して ack する", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const syncHandler = vi.fn();
    const handlers: MeetJobHandlerRegistry = { sync_members: syncHandler };
    const message = createFakeMessage({ type: "unknown_job", foo: "bar" });

    await dispatchMeetJobMessage(env, message, undefined, handlers);

    expect(syncHandler).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("429 GoogleApiError 発生時は 60 秒遅延付きで retry する", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handlers: MeetJobHandlerRegistry = {
      sync_members: vi.fn().mockRejectedValue(
        new GoogleApiError({
          httpStatus: 429,
          apiStatus: "RESOURCE_EXHAUSTED",
          apiMessage: "Quota exceeded",
        }),
      ),
    };
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
    const handlers: MeetJobHandlerRegistry = {
      sync_members: vi
        .fn()
        .mockRejectedValue(new GoogleConnectionError("invalid_grant", "失効しました")),
    };
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
