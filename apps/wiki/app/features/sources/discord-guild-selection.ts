import type { DiscordGuildConfig } from "./classify";

export type DiscordGuildSelection = {
  wholeServer: boolean;
  autoDiscover: boolean;
  categoryIds: ReadonlySet<string>;
  channelIds: ReadonlySet<string>;
  groups: ReadonlyArray<{ categoryId: string | null; channels: ReadonlyArray<{ id: string }> }>;
};

export function discordGuildSelectionConfig(selection: DiscordGuildSelection): DiscordGuildConfig {
  if (selection.wholeServer) {
    return {
      all: true,
      include: { categories: [], channels: [] },
      exclude: { channels: [] },
      autoDiscover: true,
    };
  }
  const { autoDiscover, categoryIds, channelIds } = selection;
  const channelsInSelectedCategories = new Set(
    selection.groups
      .filter((group) => group.categoryId && categoryIds.has(group.categoryId))
      .flatMap((group) => group.channels.map((channel) => channel.id)),
  );
  return {
    all: false,
    include: {
      categories: autoDiscover ? [...categoryIds] : [],
      channels: [...channelIds].filter(
        (id) => !autoDiscover || !channelsInSelectedCategories.has(id),
      ),
    },
    exclude: {
      channels: autoDiscover
        ? [...channelsInSelectedCategories].filter((id) => !channelIds.has(id))
        : [],
    },
    autoDiscover,
  };
}

export function hasDiscordGuildSelection(selection: DiscordGuildSelection): boolean {
  return selection.wholeServer || selection.channelIds.size > 0 || selection.categoryIds.size > 0;
}
