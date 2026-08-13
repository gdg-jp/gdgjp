import { createServer } from "node:http";

const PORT = Number(process.env.CONNPASS_E2E_IDP_PORT ?? 5181);
const CHAPTERS_CLAIM = "https://gdgs.jp/claims/chapters";
const IS_ADMIN_CLAIM = "https://gdgs.jp/claims/is_admin";

const identities = {
  "e2e-admin": {
    sub: "e2e-admin-user",
    email: "admin@e2e.local",
    name: "E2E Admin",
    [IS_ADMIN_CLAIM]: true,
    [CHAPTERS_CLAIM]: [],
  },
  "e2e-organizer": {
    sub: "e2e-organizer-user",
    email: "organizer@e2e.local",
    name: "E2E Organizer",
    [IS_ADMIN_CLAIM]: false,
    [CHAPTERS_CLAIM]: [{ chapterId: 10, chapterSlug: "e2e-chapter", role: "organizer" }],
  },
  "e2e-member": {
    sub: "e2e-member-user",
    email: "member@e2e.local",
    name: "E2E Member",
    [IS_ADMIN_CLAIM]: false,
    [CHAPTERS_CLAIM]: [{ chapterId: 10, chapterSlug: "e2e-chapter", role: "member" }],
  },
  "e2e-outsider": {
    sub: "e2e-outsider-user",
    email: "outsider@e2e.local",
    name: "E2E Outsider",
    [IS_ADMIN_CLAIM]: false,
    [CHAPTERS_CLAIM]: [{ chapterId: 99, chapterSlug: "other-chapter", role: "organizer" }],
  },
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/auth/oauth2/userinfo") {
    const authorization = req.headers.authorization ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
    const identity = identities[token];
    if (!identity) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_token" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(identity));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[e2e mock IdP] http://127.0.0.1:${PORT}`);
});
