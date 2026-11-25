import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "node:http";
import { Agent, createServer, request as httpsRequest } from "node:https";
import type { Socket } from "node:net";
import type { TLSSocket } from "node:tls";
import { type AccessScope, inAccessScope, isTestDomain } from "../scripts/access-origin.mjs";
import type { AccessToken } from "./access";
import { selfSignedCertificate } from "./certificate";

export type Upstream =
  | { readonly kind: "dns" }
  | {
      readonly kind: "loopback";
      readonly address: string;
      readonly port: number;
      readonly ca: Buffer | string;
    };

export type Dial = { readonly host: string; readonly address: string; readonly port: number };

export type Forwarder = {
  readonly port: number;
  readonly spki: string;
  readonly certificate: Buffer;
  readonly chromiumArgs: readonly string[];
  readonly dials: readonly Dial[];
  close(): Promise<void>;
};

const LOOPBACK_ADDRESS = /^(?:127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}|::1)$/;

const HOP_BY_HOP = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const ACCESS_COOKIE = /^\s*CF_Authorization=/i;

function upstreamHeaders(
  request: IncomingMessage,
  host: string,
  token: AccessToken,
  upgrade: boolean,
): OutgoingHttpHeaders {
  const headers: Record<string, string | string[]> = {};
  const raw = request.rawHeaders;
  for (let index = 0; index + 1 < raw.length; index += 2) {
    const name = (raw[index] as string).toLowerCase();
    const value = raw[index + 1] as string;
    if (name.startsWith(":") || name.startsWith("cf-access-")) continue;
    const kept = upgrade ? name === "connection" || name === "upgrade" : name === "content-length";
    if (HOP_BY_HOP.has(name) && !kept) continue;
    if (name === "cookie") {
      const kept = value
        .split(";")
        .filter((part) => part.trim() && !ACCESS_COOKIE.test(part))
        .join(";")
        .trim();
      if (kept) headers.cookie = headers.cookie ? `${headers.cookie}; ${kept}` : kept;
      continue;
    }
    const existing = headers[name];
    headers[name] = existing === undefined ? value : [existing, value].flat();
  }
  headers.host = host;
  headers["cf-access-client-id"] = token.id;
  headers["cf-access-client-secret"] = token.secret;
  return headers;
}

function downstreamHeaders(raw: readonly string[], upgrade: boolean): string[] {
  const kept: string[] = [];
  for (let index = 0; index + 1 < raw.length; index += 2) {
    const name = raw[index] as string;
    const value = raw[index + 1] as string;
    const lower = name.toLowerCase();
    if (lower === "set-cookie" && ACCESS_COOKIE.test(value)) continue;
    if (
      !upgrade &&
      (lower === "connection" ||
        lower === "keep-alive" ||
        lower === "transfer-encoding" ||
        lower === "proxy-connection" ||
        lower === "upgrade")
    )
      continue;
    kept.push(name, value);
  }
  return kept;
}

export function forwardedTarget(
  scope: AccessScope,
  request: Pick<IncomingMessage, "headers" | "url" | "socket">,
): URL | null {
  const host = request.headers.host;
  const sni = (request.socket as TLSSocket).servername;
  if (!host || typeof sni !== "string" || host.toLowerCase() !== sni.toLowerCase()) return null;
  if (!request.url?.startsWith("/") || request.url.startsWith("//")) return null;
  const candidate = `https://${host}${request.url}`;
  if (!inAccessScope(scope, candidate)) return null;
  const url = new URL(candidate);
  if (url.host !== host.toLowerCase() || url.protocol !== "https:") return null;
  return url;
}

function refuse(response: ServerResponse) {
  response
    .writeHead(421, { "content-type": "text/plain", "x-ui-fuzz-forwarder": "refused" })
    .end("The UI fuzz forwarder only serves the slot's https hosts.");
}

export async function startForwarder({
  scope,
  token,
  upstream,
  onDial,
  idleTimeoutMs = 120_000,
}: {
  readonly scope: AccessScope;
  readonly token: AccessToken;
  readonly upstream: Upstream;
  readonly onDial?: (dial: Dial) => void;
  readonly idleTimeoutMs?: number;
}): Promise<Forwarder> {
  const domain = scope.domain;
  if (!domain) throw new Error("The forwarder needs a slot domain");
  if (upstream.kind === "loopback") {
    if (!LOOPBACK_ADDRESS.test(upstream.address))
      throw new Error(`A loopback upstream must be a loopback address: ${upstream.address}`);
    if (!isTestDomain(domain))
      throw new Error(`A loopback upstream only serves a .test domain, not ${domain}`);
  } else if (isTestDomain(domain)) {
    throw new Error(`${domain} is a test domain; give the forwarder a loopback upstream`);
  }
  const certificate = selfSignedCertificate();
  const agent = new Agent({ keepAlive: true, maxSockets: 32 });
  const dials: Dial[] = [];
  const sockets = new Set<Socket>();
  const dial = (host: string) => {
    const target =
      upstream.kind === "loopback"
        ? { host, address: upstream.address, port: upstream.port }
        : { host, address: host, port: 443 };
    dials.push(target);
    onDial?.(target);
    return {
      host: target.address,
      port: target.port,
      servername: host,
      agent,
      rejectUnauthorized: true,
      ...(upstream.kind === "loopback" ? { ca: upstream.ca } : {}),
    };
  };
  const server = createServer(
    { key: certificate.key, cert: certificate.cert },
    (request, response) => {
      const url = forwardedTarget(scope, request);
      if (!url) {
        request.resume();
        refuse(response);
        return;
      }
      const outgoing = httpsRequest(
        {
          ...dial(url.hostname),
          method: request.method,
          path: `${url.pathname}${url.search}`,
          headers: upstreamHeaders(request, url.hostname, token, false),
        },
        (incoming) => {
          response.writeHead(
            incoming.statusCode ?? 502,
            incoming.statusMessage,
            downstreamHeaders(incoming.rawHeaders, false),
          );
          incoming.pipe(response);
          incoming.on("error", () => response.destroy());
        },
      );
      outgoing.setTimeout(idleTimeoutMs, () => outgoing.destroy(new Error("upstream idle")));
      outgoing.on("error", () => {
        if (!response.headersSent)
          response
            .writeHead(502, {
              "content-type": "text/plain",
              "x-ui-fuzz-forwarder": "upstream-error",
            })
            .end("The UI fuzz forwarder could not reach the slot.");
        else response.destroy();
      });
      response.on("close", () => {
        if (!response.writableFinished) outgoing.destroy();
      });
      request.pipe(outgoing);
    },
  );
  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (request: IncomingMessage, socket: Socket, head: Buffer) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    const url = forwardedTarget(scope, request);
    if (!url) {
      socket.end(
        "HTTP/1.1 421 Misdirected Request\r\nconnection: close\r\ncontent-length: 0\r\n\r\n",
      );
      return;
    }
    const outgoing = httpsRequest({
      ...dial(url.hostname),
      agent: false,
      method: request.method,
      path: `${url.pathname}${url.search}`,
      headers: upstreamHeaders(request, url.hostname, token, true),
    });
    outgoing.on("upgrade", (incoming, upstreamSocket, upstreamHead) => {
      sockets.add(upstreamSocket);
      upstreamSocket.on("close", () => sockets.delete(upstreamSocket));
      const headers = downstreamHeaders(incoming.rawHeaders, true);
      const lines = [`HTTP/1.1 ${incoming.statusCode} ${incoming.statusMessage ?? ""}`];
      for (let index = 0; index + 1 < headers.length; index += 2)
        lines.push(`${headers[index]}: ${headers[index + 1]}`);
      socket.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) upstreamSocket.write(head);
      upstreamSocket.pipe(socket);
      socket.pipe(upstreamSocket);
      upstreamSocket.on("error", () => socket.destroy());
      socket.on("close", () => upstreamSocket.destroy());
    });
    outgoing.on("response", (incoming) => {
      const headers = downstreamHeaders(incoming.rawHeaders, false);
      const lines = [`HTTP/1.1 ${incoming.statusCode} ${incoming.statusMessage ?? ""}`];
      for (let index = 0; index + 1 < headers.length; index += 2)
        lines.push(`${headers[index]}: ${headers[index + 1]}`);
      socket.write(`${lines.join("\r\n")}\r\nconnection: close\r\n\r\n`);
      incoming.pipe(socket);
    });
    outgoing.on("error", () => socket.destroy());
    outgoing.end();
  });
  server.on("tlsClientError", (_error, socket) => socket.destroy());
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => done());
  });
  const port = (server.address() as { port: number }).port;
  const rules = [
    `MAP *.${domain}:443 127.0.0.1:${port}`,
    `MAP ${domain}:443 127.0.0.1:${port}`,
    ...(upstream.kind === "loopback"
      ? ["MAP * ~NOTFOUND", "EXCLUDE localhost", "EXCLUDE 127.0.0.1"]
      : []),
  ];
  return {
    port,
    spki: certificate.spki,
    certificate: certificate.cert,
    chromiumArgs: [
      `--host-resolver-rules=${rules.join(", ")}`,
      `--ignore-certificate-errors-spki-list=${certificate.spki}`,
      "--disable-quic",
    ],
    dials,
    close: async () => {
      await new Promise<void>((done) => {
        server.close(() => done());
        for (const socket of sockets) socket.destroy();
        server.closeAllConnections?.();
      });
      agent.destroy();
    },
  };
}
