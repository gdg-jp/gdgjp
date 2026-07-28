import { redirect } from "react-router";
import { requireSnsAccess } from "~/lib/access.server";
import { getPost } from "~/lib/db.server";
import { nowIso } from "~/lib/utils";
import { codeChallenge, randomVerifier } from "~/lib/x.server";
import type { Route } from "./+types/google.photos.connect";
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const access = await requireSnsAccess(env, request);
  const postId = new URL(request.url).searchParams.get("postId");
  const post = postId ? await getPost(env.DB, postId) : null;
  if (!post || post.chapterId !== access.chapter.chapterId)
    throw new Response("Not found", { status: 404 });
  const state = crypto.randomUUID();
  const verifier = randomVerifier();
  await env.DB.prepare(
    "INSERT INTO oauth_transactions (state, provider, user_id, chapter_id, code_verifier, return_to, expires_at, created_at) VALUES (?, 'google_photos', ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      state,
      access.user.id,
      post.chapterId,
      verifier,
      `/google/photos/picker?postId=${post.id}`,
      new Date(Date.now() + 600_000).toISOString(),
      nowIso(),
    )
    .run();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_PHOTOS_CLIENT_ID,
    redirect_uri: `${env.APP_URL}/google/photos/callback`,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/photospicker.mediaitems.readonly",
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: await codeChallenge(verifier),
    code_challenge_method: "S256",
  }).toString();
  throw redirect(url.toString());
}
