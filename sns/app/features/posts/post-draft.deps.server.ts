import { fetchLinkPreview } from "~/lib/link-preview.server";
import { resolveXUsername } from "~/lib/x.server";
import type { PostDraftDependencies } from "./post.types";

/** Wires the aggregate draft service to the Worker's real D1/R2/X/OGP surfaces. */
export function postDraftDepsFromEnv(env: Env): PostDraftDependencies {
  return {
    db: env.DB,
    media: env.MEDIA,
    linkPreviewForText: (text) => fetchLinkPreview(text),
    resolveTagHandle: (xAccountId, handle) => resolveXUsername(env, xAccountId, handle),
  };
}
