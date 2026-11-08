import type { DiscordGuildConfig } from "./classify";

/** What the Discord server dialog has picked. */
export type DiscordGuildSelection = {
  wholeServer: boolean;
  autoDiscover: boolean;
  categoryIds: ReadonlySet<string>;
  channelIds: ReadonlySet<string>;
  /** The server's current channel list, grouped by category. */
  groups: ReadonlyArray<{ categoryId: string | null; channels: ReadonlyArray<{ id: string }> }>;
};

/**
 * The `discord-guild` source config for a dialog selection. The whole server stands for
 * every channel now and later; otherwise, with auto-discover, a category stands for its
 * channels now and later, and without it the selection is exactly the checked channels.
 */
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
    // Unchecked channels inside a selected category are explicit exclusions.
    exclude: {
      channels: autoDiscover
        ? [...channelsInSelectedCategories].filter((id) => !channelIds.has(id))
        : [],
    },
    autoDiscover,
  };
}

/** Whether the selection picks anything to import. */
export function hasDiscordGuildSelection(selection: DiscordGuildSelection): boolean {
  return selection.wholeServer || selection.channelIds.size > 0 || selection.categoryIds.size > 0;
}
