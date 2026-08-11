export function meta() {
  return [{ title: "GDG Japan Connpass API" }];
}

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">connpass.gdgs.jp</h1>
      <p className="text-muted-foreground text-sm leading-relaxed">
        Machine API for GDG chapter connpass administration. Authenticate with a GDG Accounts Bearer
        token from the CLI or agents. See OpenAPI at{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">/openapi</code> in the repository.
      </p>
      <ul className="text-sm text-muted-foreground list-disc pl-5">
        <li>POST /api/groups/:groupId/events — create draft (async job)</li>
        <li>POST /api/groups/:groupId/events/:eventId/publish — publish (async job)</li>
        <li>GET /api/jobs/:jobId — job status</li>
      </ul>
    </main>
  );
}
