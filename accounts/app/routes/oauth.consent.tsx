import { Form, redirect, useSearchParams } from "react-router";
import { getAuth } from "~/lib/auth.server";
import type { Route } from "./+types/oauth.consent";

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const oauthQuery = String(form.get("oauth_query") ?? "");
  const accept = form.get("accept") === "true";
  const url = new URL(request.url);
  url.pathname = "/api/auth/oauth2/consent";
  const response = await getAuth(context.cloudflare.env).handler(
    new Request(url, {
      method: "POST",
      headers: { cookie: request.headers.get("cookie") ?? "", "content-type": "application/json" },
      body: JSON.stringify({ accept, oauth_query: oauthQuery }),
    }),
  );
  if (!response.ok) return response;
  const data = (await response.json()) as { redirect_uri?: string };
  if (!data.redirect_uri) return new Response("Invalid consent response", { status: 500 });
  throw redirect(data.redirect_uri);
}

export default function ConsentPage() {
  const [params] = useSearchParams();
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-6 px-6">
      <h1 className="text-2xl font-semibold">Authorize application</h1>
      <p className="text-muted-foreground">
        The application requests: {params.get("scope") ?? "basic account access"}
      </p>
      <Form method="post" className="flex gap-3">
        <input type="hidden" name="oauth_query" value={params.toString()} />
        <button
          type="submit"
          name="accept"
          value="true"
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground"
        >
          Allow
        </button>
        <button type="submit" name="accept" value="false" className="rounded-md border px-4 py-2">
          Deny
        </button>
      </Form>
    </main>
  );
}
