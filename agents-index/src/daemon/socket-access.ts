import { execFileSync } from "node:child_process";
import { chmod, chown } from "node:fs/promises";

export function lookupGroupId(name: string): number | undefined {
  try {
    const gid = Number(
      execFileSync("getent", ["group", name], { encoding: "utf8" }).trim().split(":")[2],
    );
    return Number.isInteger(gid) ? gid : undefined;
  } catch {
    return undefined;
  }
}

export async function applyIndexSocketAccess(
  socketPath: string,
  socketGroup?: string,
): Promise<void> {
  await chmod(socketPath, 0o660);
  if (!socketGroup) return;
  const gid = lookupGroupId(socketGroup);
  const uid = process.getuid?.();
  if (gid === undefined || uid === undefined) return;
  try {
    await chown(socketPath, uid, gid);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `agents-index: could not chown ${socketPath} to ${socketGroup}: ${detail}\n`,
    );
  }
}
