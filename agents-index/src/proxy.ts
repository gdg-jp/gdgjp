#!/usr/bin/env node
import { createConnection } from "node:net";

const socketPath = process.env.AGENTS_INDEX_SOCKET;
if (!socketPath) throw new Error("AGENTS_INDEX_SOCKET is required");
const daemon = createConnection(socketPath);
daemon.on("error", () => {
  process.exitCode = 1;
});
daemon.setEncoding("utf8");
process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", (data: string) => {
  buffer += data;
  let newline = buffer.indexOf("\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\n");
    if (!line) continue;
    try {
      const request = JSON.parse(line) as Record<string, unknown>;
      request.nonce = process.env.XANGI_AUTHZ_NONCE;
      daemon.write(`${JSON.stringify(request)}\n`);
    } catch {
      process.stdout.write(
        '{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error"}}\n',
      );
    }
  }
});
daemon.on("data", (data: string) => process.stdout.write(data));
