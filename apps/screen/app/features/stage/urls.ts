import type { OutputKind, Slot } from "./protocol";

export function inviteUrl(origin: string, inviteToken: string): string {
  return `${origin}/join/${inviteToken}`;
}

export function outputUrl(
  origin: string,
  stageId: string,
  slot: Slot,
  kind: OutputKind,
  outputToken: string,
): string {
  return `${origin}/out/${stageId}/${slot}/${kind}?t=${encodeURIComponent(outputToken)}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
