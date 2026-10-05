import { request } from "node:http";

import type { PermissionClass, SourceAudienceKey } from "@gdgjp/gdg-lib/acl/agent";

export type ResolvedPrincipal = { classes: PermissionClass[]; channelAudience: SourceAudienceKey };

function isAudience(value: unknown): value is SourceAudienceKey {
  if (!value || typeof value !== "object" || typeof (value as { kind?: unknown }).kind !== "string")
    return false;
  const kind = (value as { kind: string }).kind;
  return (
    ["private", "member", "organizer"].includes(kind) ||
    (["chapter-member", "chapter-organizer"].includes(kind) &&
      typeof (value as { chapterId?: unknown }).chapterId === "string")
  );
}

export async function resolvePrincipal(
  nonce = process.env.XANGI_AUTHZ_NONCE,
  socketPath = process.env.XANGI_AUTHZ_SOCKET,
): Promise<ResolvedPrincipal | null> {
  if (!nonce || !socketPath) return null;
  try {
    const body = await new Promise<string>((resolve, reject) => {
      const req = request(
        { socketPath, path: `/resolve?nonce=${encodeURIComponent(nonce)}`, method: "GET" },
        (response) => {
          let value = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => {
            value += chunk;
          });
          response.on("end", () =>
            response.statusCode === 200
              ? resolve(value)
              : reject(new Error("authz rejected nonce")),
          );
        },
      );
      req.setTimeout(1_000, () => req.destroy(new Error("authz timeout")));
      req.on("error", reject);
      req.end();
    });
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as { classes?: unknown; channelAudience?: unknown };
    if (!Array.isArray(record.classes) || !isAudience(record.channelAudience)) return null;
    const classes = record.classes.flatMap((item): PermissionClass[] =>
      item &&
      typeof item === "object" &&
      typeof (item as { chapterId?: unknown }).chapterId === "string" &&
      ((item as { role?: unknown }).role === "member" ||
        (item as { role?: unknown }).role === "organizer")
        ? [item as PermissionClass]
        : [],
    );
    return { classes, channelAudience: record.channelAudience };
  } catch {
    return null;
  }
}
