import type { BearerClient } from "@gdgjp/gdg-lib";

export function writesAllowed(client: BearerClient | null | undefined): boolean {
  return client?.firstParty === true;
}

export function developerAppWriteRefused(): Response {
  return Response.json(
    { error: "forbidden", error_description: "writes require a first-party client" },
    { status: 403 },
  );
}
