export function redirect(location: string, headers: HeadersInit = {}): Response {
  const result = new Headers(headers);
  result.set("Location", location);
  return new Response(null, { headers: result, status: 302 });
}

export function html(body: string, status = 200, headers: HeadersInit = {}): Response {
  const result = new Headers(headers);
  result.set("Content-Type", "text/html; charset=UTF-8");
  result.set("Cache-Control", "no-store");
  return new Response(body, { headers: result, status });
}
