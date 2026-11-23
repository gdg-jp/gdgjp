import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const COPY_WORKER_SOURCE = `export default {
  async fetch(request, env) {
    if (!env.SYNC_TOKEN || request.headers.get("authorization") !== "Bearer " + env.SYNC_TOKEN)
      return new Response("forbidden", { status: 403 });
    const { pair, cursor, phase } = await request.json();
    const source = env["SRC_" + pair];
    const target = env["DST_" + pair];
    if (!source || !target) return Response.json({ error: "unknown pair" }, { status: 400 });
    if (phase === "prune") {
      const listed = await target.list({ cursor: cursor || undefined, limit: 100 });
      let deleted = 0;
      for (const object of listed.objects)
        if (!(await source.head(object.key))) {
          await target.delete(object.key);
          deleted++;
        }
      return Response.json({ cursor: listed.truncated ? listed.cursor : null, deleted });
    }
    const listed = await source.list({ cursor: cursor || undefined, limit: 40 });
    let copied = 0;
    let skipped = 0;
    for (const object of listed.objects) {
      const existing = await target.head(object.key);
      if (existing && existing.etag === object.etag && existing.size === object.size) {
        skipped++;
        continue;
      }
      const body = await source.get(object.key);
      if (!body) continue;
      await target.put(object.key, body.body, {
        httpMetadata: body.httpMetadata,
        customMetadata: body.customMetadata,
      });
      copied++;
    }
    return Response.json({ cursor: listed.truncated ? listed.cursor : null, copied, skipped });
  },
};
`;

export function copyWorkerConfig({ name, pairs, compatibilityDate }) {
  return {
    name,
    main: "worker.mjs",
    compatibility_date: compatibilityDate,
    workers_dev: true,
    preview_urls: false,
    r2_buckets: pairs.flatMap(({ source, target }, index) => [
      { binding: `SRC_${index}`, bucket_name: source },
      { binding: `DST_${index}`, bucket_name: target },
    ]),
  };
}

async function drive(url, token, body, fetchImpl) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) return response.json();
    if (attempt >= 5) throw new Error(`R2 copy request failed with ${response.status}`);
    await new Promise((done) => setTimeout(done, attempt * 2000));
  }
}

export async function copyBuckets({
  name,
  pairs,
  compatibilityDate,
  subdomain,
  runWrangler,
  log,
  fetchImpl = fetch,
}) {
  if (!pairs.length) return;
  const scratch = mkdtempSync(join(tmpdir(), "gdgjp-r2-copy-"));
  const token = randomBytes(32).toString("base64url");
  try {
    writeFileSync(join(scratch, "worker.mjs"), COPY_WORKER_SOURCE);
    writeFileSync(
      join(scratch, "wrangler.json"),
      JSON.stringify(copyWorkerConfig({ name, pairs, compatibilityDate })),
    );
    runWrangler(["deploy", "--config", join(scratch, "wrangler.json")], { cwd: scratch });
    runWrangler(["secret", "put", "SYNC_TOKEN", "--name", name], { cwd: scratch, input: token });
    const url = `https://${name}.${subdomain}.workers.dev/`;
    for (let ready = 0; ; ready++) {
      const response = await fetchImpl(url, { method: "POST", body: "{}" }).catch(() => null);
      if (response?.status === 403) break;
      if (ready > 30) throw new Error(`${url} did not become reachable`);
      await new Promise((done) => setTimeout(done, 2000));
    }
    for (const [index, { source, target }] of pairs.entries()) {
      for (const phase of ["copy", "prune"]) {
        let cursor = null;
        let total = 0;
        do {
          const result = await drive(url, token, { pair: index, cursor, phase }, fetchImpl);
          total += result.copied ?? result.deleted ?? 0;
          cursor = result.cursor;
        } while (cursor);
        log(`${phase === "copy" ? "copied" : "pruned"} ${total} objects ${source} -> ${target}`);
      }
    }
  } finally {
    try {
      runWrangler(["delete", "--name", name, "--force"], { cwd: scratch });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}
