import { execFileSync } from "node:child_process";
import { createHash, createPublicKey } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Certificate = { readonly key: Buffer; readonly cert: Buffer; readonly spki: string };

export function spkiHash(cert: Buffer | string): string {
  return createHash("sha256")
    .update(createPublicKey(cert).export({ type: "spki", format: "der" }))
    .digest("base64");
}

export function selfSignedCertificate(names: readonly string[] = []): Certificate {
  const directory = mkdtempSync(join(tmpdir(), "ui-fuzz-certificate-"));
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        join(directory, "key.pem"),
        "-out",
        join(directory, "cert.pem"),
        "-days",
        "1",
        "-subj",
        "/CN=ui-fuzz forwarder",
        ...(names.length
          ? ["-addext", `subjectAltName=${names.map((name) => `DNS:${name}`).join(",")}`]
          : []),
      ],
      { stdio: "ignore" },
    );
    const cert = readFileSync(join(directory, "cert.pem"));
    return { key: readFileSync(join(directory, "key.pem")), cert, spki: spkiHash(cert) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
