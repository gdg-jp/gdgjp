import type { Command, PlayerStatus } from "./protocol";

export type ConfirmKind = "pause" | "stopLoop" | "restart" | "switch" | "seek";

export type Intent = { cmd: Command; confirm: ConfirmKind | null };

export type Now = { clipId: string | null; status: PlayerStatus };

export function isAudible(status: PlayerStatus): boolean {
  return status === "playing" || status === "gap";
}

export function primaryIntent(clipId: string, cueMs: number, now: Now): Intent {
  if (now.clipId === clipId) {
    if (now.status === "playing") return { cmd: { kind: "pause" }, confirm: "pause" };
    if (now.status === "gap") return { cmd: { kind: "pause" }, confirm: "stopLoop" };
    if (now.status === "paused") return { cmd: { kind: "resume" }, confirm: null };
  }
  return {
    cmd: {
      kind: "play",
      clipId,
      fromMs: now.clipId === clipId && now.status === "ended" ? 0 : cueMs,
    },
    confirm: isAudible(now.status) ? "switch" : null,
  };
}

export function restartIntent(now: Now): Intent {
  return { cmd: { kind: "restart" }, confirm: isAudible(now.status) ? "restart" : null };
}

export function seekIntent(ms: number, now: Now): Intent {
  return {
    cmd: { kind: "seek", ms: Math.max(0, Math.round(ms)) },
    confirm: isAudible(now.status) ? "seek" : null,
  };
}

export function showsPause(clipId: string, now: Now): boolean {
  return now.clipId === clipId && isAudible(now.status);
}

export const confirmCopy: Record<ConfirmKind, { title: string; action: string }> = {
  pause: { title: "再生を停止しますか？", action: "停止する" },
  stopLoop: { title: "ループを停止しますか？", action: "停止する" },
  restart: { title: "最初から再生しますか？", action: "最初から再生する" },
  switch: { title: "再生を切り替えますか？", action: "切り替える" },
  seek: { title: "再生位置を移動しますか？", action: "移動する" },
};
