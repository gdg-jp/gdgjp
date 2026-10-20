import { createRequestHandler } from "react-router";
import { canUseController, getOptionalUser } from "../app/features/auth/auth-redirect.server";
import { forwardToSfu } from "../app/features/rtc/sfu-proxy.server";
import { isSlot } from "../app/features/stage/protocol";
import { isStageId } from "../app/features/stage/stage-id";
import {
  type StageRow,
  getStage,
  metaOf,
  timingSafeEqual,
} from "../app/features/stage/stages.server";
import { ROOM_HEADERS } from "./stage-room";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env?.MODE ?? "production",
);

const PEER_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Who is calling, from one of:
 *   - `invite:<stageId>` speaker (the invite link is the stage id)
 *   - `output:<token>`  OBS Browser Source
 *   - session cookie    operator (chapter member)
 */
async function authorize(
  env: Env,
  request: Request,
  stage: StageRow,
  credential: string | null,
): Promise<"speaker" | "output" | "operator" | null> {
  if (credential?.startsWith("invite:")) {
    return timingSafeEqual(credential.slice(7), stage.id) ? "speaker" : null;
  }
  if (credential?.startsWith("output:")) {
    return timingSafeEqual(credential.slice(7), stage.outputToken) ? "output" : null;
  }
  return (await canUseController(env, request)) ? "operator" : null;
}

async function handleSocket(request: Request, env: Env, url: URL): Promise<Response> {
  const role = url.searchParams.get("role");
  let stage: StageRow | null = null;
  const headers = new Headers(request.headers);

  if (role === "speaker") {
    const invite = url.searchParams.get("invite");
    stage = isStageId(invite) ? await getStage(env.DB, invite) : null;
    if (!stage) return new Response("bad invite", { status: 403 });
    const pid = url.searchParams.get("pid") ?? "";
    if (!PEER_ID_RE.test(pid)) return new Response("bad pid", { status: 400 });
    headers.set(ROOM_HEADERS.peerId, `sp-${pid}`);
    headers.set(ROOM_HEADERS.name, encodeURIComponent(url.searchParams.get("name") ?? ""));
  } else if (role === "output" || role === "operator") {
    const id = url.searchParams.get("stage");
    if (!isStageId(id)) return new Response("bad stage", { status: 400 });
    stage = await getStage(env.DB, id);
    if (!stage) return new Response("no stage", { status: 404 });
    if (role === "output") {
      const slot = url.searchParams.get("slot");
      if (!isSlot(slot)) return new Response("bad slot", { status: 400 });
      if (!timingSafeEqual(url.searchParams.get("t") ?? "", stage.outputToken)) {
        return new Response("bad token", { status: 403 });
      }
      headers.set(ROOM_HEADERS.slot, slot);
    } else {
      if (!(await canUseController(env, request))) {
        return new Response("unauthorized", { status: 401 });
      }
      const tab = url.searchParams.get("pid") ?? "";
      if (!PEER_ID_RE.test(tab)) return new Response("bad pid", { status: 400 });
      const user = await getOptionalUser(env, request).catch(() => null);
      headers.set(ROOM_HEADERS.peerId, `op-${tab}`);
      headers.set(ROOM_HEADERS.name, encodeURIComponent(user?.name ?? "配信担当"));
    }
  } else {
    return new Response("bad role", { status: 400 });
  }

  headers.set(ROOM_HEADERS.role, role);
  headers.set(ROOM_HEADERS.meta, JSON.stringify(metaOf(stage)));
  return env.STAGE.getByName(stage.id).fetch(new Request(request.url, { headers }));
}

async function handleRtc(request: Request, env: Env, url: URL): Promise<Response> {
  const [, , stageId, ...rest] = url.pathname.split("/");
  if (!isStageId(stageId)) return new Response("bad stage", { status: 400 });
  const stage = await getStage(env.DB, stageId);
  if (!stage) return new Response("no stage", { status: 404 });
  const who = await authorize(env, request, stage, request.headers.get("x-screen-auth"));
  if (!who) return new Response("unauthorized", { status: 401 });
  return forwardToSfu(env, request, rest.join("/"));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/ws" && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      return handleSocket(request, env, url);
    }
    if (url.pathname.startsWith("/rtc/")) return handleRtc(request, env, url);
    return requestHandler(request, { cloudflare: { env, ctx } });
  },
} satisfies ExportedHandler<Env>;

export { StageRoom } from "./stage-room";
