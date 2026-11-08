import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  FormField,
  Inline,
  Stack,
  Switch,
} from "@gdgjp/design-system";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@gdgjp/design-system";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  discordGuildSelectionConfig,
  hasDiscordGuildSelection,
} from "~/features/sources/discord-guild-selection";
import { SOURCE_KINDS } from "~/features/sources/kinds";
import type { StagedSource } from "~/features/sources/staged-candidates";
import { DiscordChannelChecklist } from "./DiscordChannelChecklist";

import { Icons } from "@gdgjp/design-system";

/**
 * Discord server picker: stages ONE `discord-guild` source per server — the whole server by
 * default, or the chosen categories / channels (one visibility per server — register the
 * server again for a category that needs a narrower visibility). `error` is owned by the
 * parent so a duplicate-source message survives the dialog closing.
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
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<string>>(() => new Set());
  const [autoDiscover, setAutoDiscover] = useState(true);
  const [wholeServer, setWholeServer] = useState(true);
  const [discordBotInviteUrl, setDiscordBotInviteUrl] = useState<string | null>(null);
  const [discordInviteUrl, setDiscordInviteUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedDiscordGuildId(null);
    setDiscordChannelGroups([]);
    setSelectedDiscordChannelIds(new Set());
    setSelectedCategoryIds(new Set());
    setWholeServer(true);
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
    setDiscordChannelGroups([]);
    setSelectedDiscordChannelIds(new Set());
    setSelectedCategoryIds(new Set());
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

  /** A whole category: its current channels, and (with auto-discover) later ones too. */
  function toggleCategory(categoryId: string, channelIds: string[]) {
    const selecting = !selectedCategoryIds.has(categoryId);
    setSelectedCategoryIds((current) => {
      const next = new Set(current);
      if (selecting) next.add(categoryId);
      else next.delete(categoryId);
      return next;
    });
    setSelectedDiscordChannelIds((current) => {
      const next = new Set(current);
      for (const id of channelIds) {
        if (selecting) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  const guildCandidateId = selectedDiscordGuildId
    ? SOURCE_KINDS["discord-guild"].candidateId(selectedDiscordGuildId)
    : null;
  const guildAlreadyRegistered = guildCandidateId
    ? registeredCandidateIds.has(guildCandidateId)
    : false;

  const selection = {
    wholeServer,
    autoDiscover,
    categoryIds: selectedCategoryIds,
    channelIds: selectedDiscordChannelIds,
    groups: discordChannelGroups,
  };
  // The channel list loading is what proves the bot is in the server.
  const canStage =
    !guildAlreadyRegistered &&
    discordChannelGroups.length > 0 &&
    !discordChannelsLoading &&
    hasDiscordGuildSelection(selection);

  function stageSelectedDiscordGuild() {
    if (!selectedDiscordGuildId || !guildCandidateId || !canStage) return;
    const guildName =
      discordGuilds.find((guild) => guild.id === selectedDiscordGuildId)?.name ?? "";
    const config = discordGuildSelectionConfig(selection);
    const staged: StagedSource[] = [
      {
        id: guildCandidateId,
        kind: "discord-guild",
        title: guildName || selectedDiscordGuildId,
        url: `https://discord.com/channels/${selectedDiscordGuildId}`,
        externalId: selectedDiscordGuildId,
        config: JSON.stringify(config),
      },
    ];
    if (onStage(staged)) {
      onErrorChange(t("sources.error_duplicate_source"));
    } else {
      onErrorChange(null);
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto bg-surface sm:max-w-lg">
        <Stack className="border-b border-border px-5 py-4">
          <DialogTitle>{t("sources.discord_dialog_title")}</DialogTitle>
          <DialogDescription>{t("sources.discord_dialog_description")}</DialogDescription>
        </Stack>
        <div className="space-y-4 px-5 py-4">
          {discordGuildsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Icons name="LoaderCircle" className="size-4 animate-spin" />
              {t("sources.discord_loading_guilds")}
            </div>
          ) : needsConnection || needsReauth ? (
            <div className="flex flex-col gap-2 text-sm">
              <p>
                {needsReauth ? t("sources.discord_reauth_hint") : t("sources.connect_discord_hint")}
              </p>
              <Button type="button" variant="ghost" onClick={connectDiscord} className="w-fit">
                {t("sources.connect_discord")}
              </Button>
            </div>
          ) : (
            <>
              <div>
                <p className="mb-1 text-sm font-medium text-muted">
                  {t("sources.discord_server_label")}
                </p>
                <Select
                  value={selectedDiscordGuildId ?? undefined}
                  onValueChange={(value) => void selectDiscordGuild(value)}
                >
                  <SelectTrigger className="w-full bg-surface">
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
                <div className="rounded-md border border-border bg-neutral p-3 text-sm text-muted">
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
                      className="font-medium text-link hover:underline"
                    >
                      {t("sources.discord_invite_bot")}
                    </a>
                    {discordInviteUrl ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          selectedDiscordGuildId
                            ? void selectDiscordGuild(selectedDiscordGuildId)
                            : undefined
                        }
                      >
                        {t("sources.discord_refresh_channels")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {discordChannelsLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted">
                  <Icons name="LoaderCircle" className="size-4 animate-spin" />
                  {t("sources.discord_loading_channels")}
                </div>
              ) : null}
              {!discordChannelsLoading && discordChannelGroups.length > 0 ? (
                <FormField label={t("sources.discord_whole_server")}>
                  <Switch checked={wholeServer} onCheckedChange={setWholeServer} />
                </FormField>
              ) : null}
              {!discordChannelsLoading && discordChannelGroups.length > 0 && !wholeServer ? (
                <div>
                  <p className="mb-2 text-sm font-medium text-muted">
                    {t("sources.discord_channel_label")}
                  </p>
                  <div className="max-h-72 space-y-3 overflow-y-auto rounded-md border border-border p-2">
                    <DiscordChannelChecklist
                      groups={discordChannelGroups}
                      selectedChannelIds={selectedDiscordChannelIds}
                      selectedCategoryIds={selectedCategoryIds}
                      onToggleChannel={toggleDiscordChannel}
                      onToggleCategory={toggleCategory}
                    />
                  </div>
                </div>
              ) : null}
              {!discordChannelsLoading && discordChannelGroups.length > 0 ? (
                <div className="space-y-2">
                  {wholeServer ? null : (
                    <FormField label={t("sources.discord_auto_discover")}>
                      <Switch checked={autoDiscover} onCheckedChange={setAutoDiscover} />
                    </FormField>
                  )}
                  <p className="text-xs text-muted">{t("sources.discord_one_visibility_hint")}</p>
                  {guildAlreadyRegistered ? (
                    <p className="text-xs text-danger">{t("sources.error_duplicate_source")}</p>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </div>
        <Inline className="border-t border-border px-5 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button type="button" disabled={!canStage} onClick={stageSelectedDiscordGuild}>
            {t("sources.stage_discord_server")}
          </Button>
        </Inline>
      </DialogContent>
    </Dialog>
  );
}
