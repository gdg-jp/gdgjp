import type { Env } from "./auth/config";
import { isConfigured } from "./auth/config";
import { finishLogin, logout, startLogin } from "./auth/oidc";
import { readSession } from "./auth/session";
import { renderHome } from "./pages/demo";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/auth/login") return startLogin(request, env);
    if (url.pathname === "/auth/callback") return finishLogin(request, env);
    if (url.pathname === "/auth/logout") return logout(request, env);
    if (url.pathname !== "/") return new Response("Not found", { status: 404 });
    return home(request, env);
  },
} satisfies ExportedHandler<Env>;

async function home(request: Request, env: Env): Promise<Response> {
  const configured = isConfigured(env);
  const session = configured ? await readSession(request, env) : null;
  return renderHome(request, configured, session);
}
