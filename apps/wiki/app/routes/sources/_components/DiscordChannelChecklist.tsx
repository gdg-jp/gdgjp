import { Checkbox } from "@gdgjp/design-system";
import { useTranslation } from "react-i18next";

export type DiscordChannelGroup = {
  categoryId: string | null;
  categoryName: string | null;
  channels: Array<{ id: string; name: string; type: number; parentId: string | null }>;
};

/** Category / channel checklist for a Discord server source. */
export function DiscordChannelChecklist({
  groups,
  selectedChannelIds,
  selectedCategoryIds,
  onToggleChannel,
  onToggleCategory,
}: {
  groups: DiscordChannelGroup[];
  selectedChannelIds: Set<string>;
  selectedCategoryIds: Set<string>;
  onToggleChannel: (channelId: string) => void;
  onToggleCategory: (categoryId: string, channelIds: string[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {groups.map((group) => {
        const categoryId = group.categoryId;
        const channelIds = group.channels.map((channel) => channel.id);
        return (
          <div key={categoryId ?? "__uncategorized"}>
            {categoryId ? (
              <div className="sticky top-0 flex items-center gap-2 bg-surface px-2 py-1 text-xs font-semibold tracking-wide text-muted uppercase">
                <Checkbox
                  checked={selectedCategoryIds.has(categoryId)}
                  onCheckedChange={() => onToggleCategory(categoryId, channelIds)}
                  aria-label={t("sources.discord_whole_category", {
                    name: group.categoryName ?? "",
                  })}
                />
                <span>{group.categoryName}</span>
              </div>
            ) : (
              <p className="sticky top-0 bg-surface px-2 py-1 text-xs font-semibold tracking-wide text-muted uppercase">
                {t("sources.discord_uncategorized")}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.channels.map((channel) => (
                <li
                  key={channel.id}
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-neutral"
                >
                  <Checkbox
                    checked={selectedChannelIds.has(channel.id)}
                    onCheckedChange={() => onToggleChannel(channel.id)}
                    aria-label={`#${channel.name}`}
                  />
                  <span>#{channel.name}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}
