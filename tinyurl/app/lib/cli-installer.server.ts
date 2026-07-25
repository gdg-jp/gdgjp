const CLI_INSTALL_PATHS = new Set(["/cli/install.sh", "/cli/install.ps1"]);

type AssetsBinding = { fetch(request: Request): Promise<Response> };

export async function serveCliInstaller(
  request: Request,
  assets: AssetsBinding,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.hostname !== "gdgs.jp" || !CLI_INSTALL_PATHS.has(url.pathname)) return null;
  return assets.fetch(request);
}
