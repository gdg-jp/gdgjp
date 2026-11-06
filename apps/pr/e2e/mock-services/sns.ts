// Local stand-in for gdgjp-sns's PrService (vite.config.ts auxiliaryWorkers, dev only).
// Same contract and the same rule as sns: organizers of the chapter or super admins may post.
import { WorkerEntrypoint } from "cloudflare:workers";
import type { PrActor, SnsCreateScheduledPostInput, SnsPostSummary } from "@gdgjp/gdg-lib";

const posts = new Map<
  string,
  SnsPostSummary & { chapterId: number; text: string; xAccountId: string; actor: string }
>();
let calls = 0;
// Ids stay unique across dev-server restarts (pr keeps them in D1).
const RUN = Date.now().toString(36);

const canPost = (actor: PrActor, chapterId: number) =>
  actor.user.isAdmin ||
  actor.chapters.some((c) => c.chapterId === chapterId && c.role === "organizer");

export class PrService extends WorkerEntrypoint {
  listXAccounts({ actor, chapterId }: { actor: PrActor; chapterId: number }) {
    return {
      ok: true as const,
      canPost: canPost(actor, chapterId),
      accounts: [
        {
          id: `x-${chapterId}`,
          username: `chapter${chapterId}`,
          displayName: `Chapter ${chapterId}`,
        },
      ],
    };
  }
  createScheduledPost(input: SnsCreateScheduledPostInput) {
    calls++;
    if (!canPost(input.actor, input.chapterId)) return { ok: false as const, code: "forbidden" };
    if (input.xAccountId !== `x-${input.chapterId}`)
      return { ok: false as const, code: "account_not_found" };
    const id = `post-${RUN}-${posts.size + 1}`;
    const post = {
      id,
      status: "scheduled",
      scheduledAt: input.scheduledAt,
      publishedXPostId: null,
      failureReason: null,
    };
    posts.set(id, {
      ...post,
      chapterId: input.chapterId,
      text: input.text,
      xAccountId: input.xAccountId,
      actor: input.actor.user.id,
    });
    return { ok: true as const, post };
  }
  updatePost() {
    return { ok: false as const, code: "not_implemented" };
  }
  attachMedia() {
    return { ok: true as const, mediaId: "media-1" };
  }
  getPost({ actor, chapterId, postId }: { actor: PrActor; chapterId: number; postId: string }) {
    if (!canPost(actor, chapterId)) return { ok: false as const, code: "forbidden" };
    const post = posts.get(postId);
    if (!post || post.chapterId !== chapterId) return { ok: false as const, code: "not_found" };
    const { id, status, scheduledAt, publishedXPostId, failureReason } = post;
    return {
      ok: true as const,
      post: { id, status, scheduledAt, publishedXPostId, failureReason },
    };
  }
  // Test hooks (reached through pr's /dev/mock-services).
  mockState() {
    return { calls, posts: [...posts.values()] };
  }
  mockPublish(postId: string) {
    const post = posts.get(postId);
    if (post) Object.assign(post, { status: "published", publishedXPostId: `x-${postId}` });
    return !!post;
  }
}

export default { fetch: () => new Response("mock gdgjp-sns") };
