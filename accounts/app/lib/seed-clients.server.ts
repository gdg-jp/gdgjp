// Seeds the trusted OAuth client records into OAUTH_KV.
// Reads {APP}_CLIENT_ID / {APP}_CLIENT_SECRET / {APP}_REDIRECT_URLS env vars
// and writes a `client:${clientId}` record per app. Idempotent — overwrites any
// existing record for the same clientId.
//
// Run via POST /admin/seed-clients (admin-only).

interface ClientSpec {
  clientId: string;
  clientSecret: string;
  clientName: string;
  redirectUris: string[];
}

interface StoredClient {
  clientId: string;
  redirectUris: string[];
  clientName?: string;
  grantTypes: string[];
  responseTypes: string[];
  registrationDate: number;
  tokenEndpointAuthMethod: string;
  clientSecret: string; // hash, NOT the plaintext
}

export async function seedClients(env: Env): Promise<{ written: string[]; skipped: string[] }> {
  const specs = collectSpecs(env);
  const written: string[] = [];
  const skipped: string[] = [];
  const now = Math.floor(Date.now() / 1000);

  for (const spec of specs) {
    if (!spec.clientId || !spec.clientSecret || spec.redirectUris.length === 0) {
      skipped.push(spec.clientId || "(unknown)");
      continue;
    }
    const record: StoredClient = {
      clientId: spec.clientId,
      redirectUris: spec.redirectUris,
      clientName: spec.clientName,
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      registrationDate: now,
      tokenEndpointAuthMethod: "client_secret_basic",
      clientSecret: await sha256Hex(spec.clientSecret),
    };
    await env.OAUTH_KV.put(`client:${spec.clientId}`, JSON.stringify(record));
    written.push(spec.clientId);
  }
  return { written, skipped };
}

function collectSpecs(env: Env): ClientSpec[] {
  const specs: ClientSpec[] = [];
  const apps: Array<{
    name: string;
    id: string | undefined;
    secret: string | undefined;
    urls: string | undefined;
  }> = [
    {
      name: "GDG Japan Links",
      id: env.TINYURL_CLIENT_ID,
      secret: env.TINYURL_CLIENT_SECRET,
      urls: env.TINYURL_REDIRECT_URLS,
    },
    {
      name: "GDG Japan Wiki",
      id: env.WIKI_CLIENT_ID,
      secret: env.WIKI_CLIENT_SECRET,
      urls: env.WIKI_REDIRECT_URLS,
    },
    {
      name: "GDG Japan Image",
      id: env.IMG_CLIENT_ID,
      secret: env.IMG_CLIENT_SECRET,
      urls: env.IMG_REDIRECT_URLS,
    },
    {
      name: "GDG Japan Scheduler",
      id: env.SCHEDULER_CLIENT_ID,
      secret: env.SCHEDULER_CLIENT_SECRET,
      urls: env.SCHEDULER_REDIRECT_URLS,
    },
  ];
  for (const app of apps) {
    if (!app.id) continue;
    specs.push({
      clientId: app.id,
      clientSecret: app.secret ?? "",
      clientName: app.name,
      redirectUris: (app.urls ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });
  }
  return specs;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
