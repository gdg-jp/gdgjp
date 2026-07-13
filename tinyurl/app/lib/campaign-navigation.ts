function dataSearch(url: URL): string {
  return [...url.searchParams.entries()]
    .filter(([key]) => key !== "view")
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey),
    )
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

export type CampaignScopeChannel = {
  id: number;
  links: Array<{ id: string }>;
};

export function resolveCampaignScope(
  channels: CampaignScopeChannel[],
  searchParams: URLSearchParams,
): { selectedChannelId: number | null; selectedLinkId: string | null } {
  const requestedChannelId = Number(searchParams.get("channelId"));
  const selectedChannelId = channels.some((channel) => channel.id === requestedChannelId)
    ? requestedChannelId
    : null;
  const channelsInScope = selectedChannelId
    ? channels.filter((channel) => channel.id === selectedChannelId)
    : channels;
  const requestedLinkId = searchParams.get("linkId");
  const selectedLinkId = channelsInScope.some((channel) =>
    channel.links.some((link) => link.id === requestedLinkId),
  )
    ? requestedLinkId
    : null;
  return { selectedChannelId, selectedLinkId };
}

/** The view parameter only selects already-loaded UI and does not affect loader data. */
export function shouldReloadCampaign(
  currentUrl: URL,
  nextUrl: URL,
  defaultShouldRevalidate: boolean,
): boolean {
  if (currentUrl.pathname !== nextUrl.pathname) return defaultShouldRevalidate;
  const viewChanged = currentUrl.searchParams.get("view") !== nextUrl.searchParams.get("view");
  return viewChanged && dataSearch(currentUrl) === dataSearch(nextUrl)
    ? false
    : defaultShouldRevalidate;
}
