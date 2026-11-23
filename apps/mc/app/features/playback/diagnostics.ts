import type { LogEntry } from "./protocol";
import type { RoomView } from "./use-controller-room";

export type Issue =
  | "self-offline"
  | "no-player"
  | "multi-player"
  | "autoplay-blocked"
  | "preload-failed"
  | "preloading"
  | "muted"
  | "stalled"
  | "hidden"
  | "media-error";

export const issueText: Record<Issue, string> = {
  "self-offline": "司会PCがオフラインです",
  "no-player": "配信PCが接続されていません",
  "multi-player": "配信PCが複数接続されています",
  "autoplay-blocked": "配信PCで自動再生がブロックされています",
  "preload-failed": "配信PCで読み込めない音声があります",
  preloading: "配信PCで音声を読み込み中です",
  muted: "配信PCでミュートされています",
  stalled: "配信PCで音声が進んでいません",
  hidden: "配信PCのページが非表示です",
  "media-error": "配信PCで再生エラーが発生しました",
};

export const blockingIssues = new Set<Issue>([
  "self-offline",
  "no-player",
  "autoplay-blocked",
  "muted",
  "stalled",
]);

export function issuesOf(room: RoomView): Issue[] {
  if (room.socket !== "open") return ["self-offline"];
  const alive = room.players.filter((p) => p.alive);
  if (alive.length === 0) return ["no-player"];
  const issues: Issue[] = [];
  if (alive.length > 1) issues.push("multi-player");
  const d = room.primary?.state?.diag;
  if (d) {
    if (d.autoplay === "blocked") issues.push("autoplay-blocked");
    if (d.preload.failed.length > 0) issues.push("preload-failed");
    else if (d.preload.loaded < d.preload.total) issues.push("preloading");
    if (d.muted || d.volume === 0) issues.push("muted");
    if (d.stalled) issues.push("stalled");
    if (d.visibility === "hidden") issues.push("hidden");
    if (d.lastError) issues.push("media-error");
  }
  return issues;
}

export const logText: Record<string, string> = {
  "player-connected": "配信PC 接続",
  "player-disconnected": "配信PC 切断",
  cmd: "コマンド送信",
  "cmd-no-player": "配信PC 未接続のため失敗",
  "ack-timeout": "応答タイムアウト",
  "ack-autoplay-blocked": "自動再生ブロック",
  "ack-media-error": "再生エラー",
  "ack-not-advancing": "音声が進まない",
  "ack-unknown-clip": "不明な音声",
  "ack-invalid": "無効な操作",
  "autoplay-blocked": "自動再生ブロック",
  "autoplay-unlocked": "自動再生 解除",
  "preload-failed": "読み込み失敗",
  "network-fallback": "ネットワークから再生",
  "media-error": "再生エラー",
  muted: "ミュート",
  interrupted: "再生が中断された",
  hidden: "ページ非表示",
  stalled: "音声が進まない",
  "loop-restart-failed": "ループ再開失敗",
  "token-rotated": "Player URL 再発行",
  "catalog-refresh-failed": "音声リストの更新失敗",
};

export function describeLog(entry: LogEntry): string {
  return logText[entry.code] ?? entry.code;
}
