import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { buildDiscordSourceTitle } from "~/features/sources/staged-candidates";
import type { StagedSource } from "~/features/sources/staged-candidates";

/**
 * Guild / channel picker for staging Discord channels as sources. `error` is
 * owned by the parent so a duplicate-source message survives the dialog closing
 * (shown in the add-source section once `open` is false).
 */
export function DiscordChannelDialog({
  open,
  onOpenChange,
  registeredCandidateIds,
  error,
  onErrorChange,
  needsConnection,
  needsReauth,
  onNeedsConnectionChange,
  onNeedsReauthChange,
  onStage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  registeredCandidateIds: Set<string>;
  error: string | null;
  onErrorChange: (error: string | null) => void;
  needsConnection: boolean;
  needsReauth: boolean;
  onNeedsConnectionChange: (value: boolean) => void;
  onNeedsReauthChange: (value: boolean) => void;
  onStage: (staged: StagedSource[]) => boolean;
}) {
  const { t } = useTranslation();
  const [discordGuilds, setDiscordGuilds] = useState<
    Array<{
      id: string;
      name: string;
      icon: string | null;
      botInstalled: boolean;
      inviteUrl: string | null;
    }>
  >([]);
  const [discordGuildsLoading, setDiscordGuildsLoading] = useState(false);
  const [discordChannelsLoading, setDiscordChannelsLoading] = useState(false);
  const [selectedDiscordGuildId, setSelectedDiscordGuildId] = useState<string | null>(null);
  const [discordChannels, setDiscordChannels] = useState<
    Array<{ id: string; name: string; type: number; parentId: string | null }>
  >([]);
  const [discordChannelGroups, setDiscordChannelGroups] = useState<
    Array<{
      categoryId: string | null;
      categoryName: string | null;
      channels: Array<{ id: string; name: string; type: number; parentId: string | null }>;
    }>
  >([]);
  const [selectedDiscordChannelIds, setSelectedDiscordChannelIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [discordBotInviteUrl, setDiscordBotInviteUrl] = useState<string | null>(null);
  const [discordInviteUrl, setDiscordInviteUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedDiscordGuildId(null);
    setDiscordChannels([]);
    setDiscordChannelGroups([]);
    setSelectedDiscordChannelIds(new Set());
    setDiscordInviteUrl(null);
    void loadDiscordGuilds();
  }, [open]);

  function connectDiscord() {
    window.location.assign("/api/discord/auth?returnTo=%2Fsources");
  }

  async function loadDiscordGuilds() {
    onErrorChange(null);
    onNeedsConnectionChange(false);
    onNeedsReauthChange(false);
    setDiscordGuildsLoading(true);
    try {
      const response = await fetch("/api/discord/guilds", { credentials: "same-origin" });
      const body = (await response.json().catch(() => null)) as {
        botInviteUrl?: string;
        guilds?: Array<{
          id: string;
          name: string;
          icon: string | null;
          botInstalled: boolean;
          inviteUrl: string | null;
        }>;
        error?: string;
        reauthorize?: boolean;
      } | null;
      if (response.status === 401) {
        onNeedsConnectionChange(true);
        return;
      }
      if (response.status === 403 && body?.reauthorize) {
        onNeedsReauthChange(true);
        return;
      }
      if (!response.ok || !body?.guilds) {
        throw new Error(body?.error ?? "guilds_list_failed");
      }
      setDiscordBotInviteUrl(body.botInviteUrl ?? null);
      setDiscordGuilds(body.guilds);
    } catch {
      onErrorChange(t("sources.error_discord_guilds"));
    } finally {
      setDiscordGuildsLoading(false);
    }
  }

  async function selectDiscordGuild(guildId: string) {
    setSelectedDiscordGuildId(guildId);
    setDiscordChannels([]);
    setDiscordChannelGroups([]);
    setSelectedDiscordChannelIds(new Set());
    setDiscordInviteUrl(null);
    onErrorChange(null);
    const guild = discordGuilds.find((item) => item.id === guildId);
    if (guild && !guild.botInstalled) {
      setDiscordInviteUrl(guild.inviteUrl);
      return;
    }
    setDiscordChannelsLoading(true);
    try {
      const response = await fetch(`/api/discord/guilds/${encodeURIComponent(guildId)}/channels`, {
        credentials: "same-origin",
      });
      const body = (await response.json().catch(() => null)) as {
        channels?: Array<{ id: string; name: string; type: number; parentId: string | null }>;
        groups?: Array<{
          categoryId: string | null;
          categoryName: string | null;
          channels: Array<{ id: string; name: string; type: number; parentId: string | null }>;
        }>;
        error?: string;
        inviteUrl?: string;
      } | null;
      if (response.status === 409 && body?.error === "bot_missing") {
        setDiscordInviteUrl(body.inviteUrl ?? null);
        return;
      }
      if (!response.ok || !body?.channels) {
        throw new Error(body?.error ?? "channels_list_failed");
      }
      const groups =
        body.groups ??
        (body.channels.length > 0
          ? [{ categoryId: null, categoryName: null, channels: body.channels }]
          : []);
      setDiscordChannelGroups(groups);
      setDiscordChannels(body.channels);
    } catch {
      onErrorChange(t("sources.error_discord_channels"));
    } finally {
      setDiscordChannelsLoading(false);
    }
  }

  function toggleDiscordChannel(channelId: string) {
    setSelectedDiscordChannelIds((current) => {
      const next = new Set(current);
      if (next.has(channelId)) next.delete(channelId);
      else next.add(channelId);
      return next;
    });
  }

  function stageSelectedDiscordChannels() {
    if (!selectedDiscordGuildId) return;
    const selected = discordChannels.filter((channel) => selectedDiscordChannelIds.has(channel.id));
    if (selected.length === 0) return;
    const guildName =
      discordGuilds.find((guild) => guild.id === selectedDiscordGuildId)?.name ?? "";
    const categoryNameByChannelId = new Map<string, string | null>();
    for (const group of discordChannelGroups) {
      for (const channel of group.channels) {
        categoryNameByChannelId.set(channel.id, group.categoryName);
      }
    }
    const staged = selected.map((channel) => ({
      id: `discord:${channel.id}`,
      kind: "discord-channel" as const,
      title: buildDiscordSourceTitle(
        guildName,
        categoryNameByChannelId.get(channel.id) ?? null,
        channel.name,
      ),
      url: `https://discord.com/channels/${selectedDiscordGuildId}/${channel.id}`,
      externalId: channel.id,
    }));
    if (onStage(staged)) {
      onErrorChange(t("sources.error_duplicate_source"));
    } else {
      onErrorChange(null);
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto bg-surface-raised sm:max-w-lg">
        <DialogHeader className="border-b border-border-subtle px-5 py-4">
          <DialogTitle>{t("sources.discord_dialog_title")}</DialogTitle>
          <DialogDescription>{t("sources.discord_dialog_description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-5 py-4">
          {discordGuildsLoading ? (
            <div className="flex items-center gap-2 text-sm text-content-secondary">
              <LoaderCircle className="size-4 animate-spin" />
              {t("sources.discord_loading_guilds")}
            </div>
          ) : needsConnection || needsReauth ? (
            <div className="flex flex-col gap-2 text-sm">
              <p>
                {needsReauth ? t("sources.discord_reauth_hint") : t("sources.connect_discord_hint")}
              </p>
              <button
                type="button"
                onClick={connectDiscord}
                className="w-fit font-medium text-action-primary hover:text-action-primary-hover"
              >
                {t("sources.connect_discord")}
              </button>
            </div>
          ) : (
            <>
              <div>
                <p className="mb-1 text-sm font-medium text-content-secondary">
                  {t("sources.discord_server_label")}
                </p>
                <Select
                  value={selectedDiscordGuildId ?? undefined}
                  onValueChange={(value) => void selectDiscordGuild(value)}
                >
                  <SelectTrigger className="w-full bg-surface-raised">
                    <SelectValue placeholder={t("sources.discord_server_placeholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {discordGuilds.map((guild) => (
                      <SelectItem key={guild.id} value={guild.id}>
                        {guild.name}
                        {!guild.botInstalled ? ` (${t("sources.discord_bot_missing_badge")})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {discordInviteUrl || (discordBotInviteUrl && !selectedDiscordGuildId) ? (
                <div className="rounded-md border border-border-default bg-surface-sunken p-3 text-sm text-content-secondary">
                  <p className="mb-2">
                    {discordInviteUrl
                      ? t("sources.discord_invite_hint")
                      : t("sources.discord_invite_hint_general")}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <a
                      href={discordInviteUrl ?? discordBotInviteUrl ?? undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-action-primary hover:underline"
                    >
                      {t("sources.discord_invite_bot")}
                    </a>
                    {discordInviteUrl ? (
                      <button
                        type="button"
                        className="text-sm text-content-secondary hover:underline"
                        onClick={() =>
                          selectedDiscordGuildId
                            ? void selectDiscordGuild(selectedDiscordGuildId)
                            : undefined
                        }
                      >
                        {t("sources.discord_refresh_channels")}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {discordChannelsLoading ? (
                <div className="flex items-center gap-2 text-sm text-content-secondary">
                  <LoaderCircle className="size-4 animate-spin" />
                  {t("sources.discord_loading_channels")}
                </div>
              ) : null}
              {!discordChannelsLoading && discordChannelGroups.length > 0 ? (
                <div>
                  <p className="mb-2 text-sm font-medium text-content-secondary">
                    {t("sources.discord_channel_label")}
                  </p>
                  <div className="max-h-72 space-y-3 overflow-y-auto rounded-md border border-border-default p-2">
                    {discordChannelGroups.map((group) => (
                      <div key={group.categoryId ?? "__uncategorized"}>
                        <p className="sticky top-0 bg-surface-raised px-2 py-1 text-xs font-semibold tracking-wide text-content-tertiary uppercase">
                          {group.categoryName ?? t("sources.discord_uncategorized")}
                        </p>
                        <ul className="space-y-0.5">
                          {group.channels.map((channel) => {
                            const already =
                              registeredCandidateIds.has(`discord:${channel.id}`) &&
                              !selectedDiscordChannelIds.has(channel.id);
                            const checked = selectedDiscordChannelIds.has(channel.id);
                            return (
                              <li key={channel.id}>
                                <label
                                  className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-hover ${
                                    already ? "opacity-50" : ""
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={already && !checked}
                                    onChange={() => toggleDiscordChannel(channel.id)}
                                  />
                                  <span>#{channel.name}</span>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}
          {error ? <p className="text-sm text-feedback-danger-foreground">{error}</p> : null}
        </div>
        <DialogFooter className="border-t border-border-subtle px-5 py-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md border border-border-strong px-4 py-2 text-sm hover:bg-surface-hover"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            disabled={selectedDiscordChannelIds.size === 0}
            onClick={stageSelectedDiscordChannels}
            className="rounded-md bg-action-primary px-4 py-2 text-sm font-medium text-action-primary-foreground hover:bg-action-primary-hover disabled:opacity-60"
          >
            {t("sources.stage_discord_channels")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
