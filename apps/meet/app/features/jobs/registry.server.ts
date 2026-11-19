import { GoogleApiError } from "~/features/google/client.server";
import { cleanupCanceledMeeting } from "~/features/meetings/cleanup-meeting.server";
import { syncMeetingMembers } from "~/features/meetings/sync-members.server";
import { type MeetJobMessage, type MeetJobType, isMeetJobMessage } from "./types";

/** 429 レート制限時に Queue へ指定する再試行遅延（Meet API 書き込み上限: 毎分 100 件/ユーザー）。 */
export const RATE_LIMIT_RETRY_DELAY_SECONDS = 60;

export type MeetJobHandler<T extends MeetJobMessage = MeetJobMessage> = (
  env: Env,
  message: T,
  ctx?: ExecutionContext,
) => Promise<void>;

export type MeetJobHandlerRegistry = {
  [K in MeetJobType]: MeetJobHandler<Extract<MeetJobMessage, { type: K }>>;
};

/**
 * ジョブ種別 → ハンドラの登録表。
 * Stage 05・06 はここに各自のジョブ種別を 1 行ずつ追加する。
 */
export const JOB_HANDLERS: MeetJobHandlerRegistry = {
  sync_members: async (env, message) => {
    await syncMeetingMembers(env, message.meetingId);
  },
  cleanup_meeting: async (env, message) => {
    await cleanupCanceledMeeting(env, message.meetingId);
  },
};

export type QueueMessageLike = Pick<Message<unknown>, "id" | "body" | "ack" | "retry">;

/** 単一の Queue メッセージを登録表へ振り分け、ack / retry を制御する。 */
export async function dispatchMeetJobMessage(
  env: Env,
  message: QueueMessageLike,
  ctx?: ExecutionContext,
  handlers: MeetJobHandlerRegistry = JOB_HANDLERS,
): Promise<void> {
  if (!isMeetJobMessage(message.body)) {
    console.warn("[meet-jobs] unknown or invalid message body, acking:", message.id);
    message.ack();
    return;
  }

  const handler = handlers[message.body.type] as MeetJobHandler | undefined;
  if (!handler) {
    console.warn("[meet-jobs] unregistered job type, acking:", message.body.type);
    message.ack();
    return;
  }

  try {
    await handler(env, message.body, ctx);
    message.ack();
  } catch (error) {
    console.error("[meet-jobs] job failed:", message.body.type, message.id, error);
    if (error instanceof GoogleApiError && error.httpStatus === 429) {
      message.retry({ delaySeconds: RATE_LIMIT_RETRY_DELAY_SECONDS });
      return;
    }
    message.retry();
  }
}

/** `workers/app.ts` の `queue` ハンドラから呼ばれるバッチ処理エントリポイント。 */
export async function processMeetJobBatch(
  batch: MessageBatch<unknown>,
  env: Env,
  ctx: ExecutionContext,
  handlers: MeetJobHandlerRegistry = JOB_HANDLERS,
): Promise<void> {
  for (const message of batch.messages) {
    await dispatchMeetJobMessage(env, message, ctx, handlers);
  }
}
