import type { OutputKind, Slot } from "./protocol";

/** The speaker invite link is the stage id itself. */
export function inviteUrl(origin: string, stageId: string): string {
  return `${origin}/${stageId}/`;
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
