import { fetchLinkPreview } from "~/features/posts/link-preview.server";
import { resolveXUsername } from "~/features/x-accounts/x-provider.server";
import type { PostDraftDependencies } from "./post.types";

export function postDraftDepsFromEnv(env: Env): PostDraftDependencies {
  return {
    db: env.DB,
    media: env.MEDIA,
    linkPreviewForText: (text) => fetchLinkPreview(text),
    resolveTagHandle: (xAccountId, handle) => resolveXUsername(env, xAccountId, handle),
  };
}
