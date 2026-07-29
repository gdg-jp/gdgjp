const WORKFLOW_DISPATCH_URL =
  "https://api.github.com/repos/gdg-jp/gdgjp/actions/workflows/google-photos-import.yml/dispatches";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function shouldDispatchGooglePhotosImport(scheduledTime: number): boolean {
  return new Date(scheduledTime).getUTCMinutes() % 5 === 0;
}

export async function dispatchGooglePhotosImport(
  token: string,
  fetcher: Fetcher = fetch,
): Promise<void> {
  const response = await fetcher(WORKFLOW_DISPATCH_URL, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": "2026-03-10",
      "user-agent": "gdgjp-album-cron",
    },
    body: JSON.stringify({ ref: "main" }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Google Photos workflow dispatch failed with status ${response.status}: ${detail}`,
    );
  }
}
