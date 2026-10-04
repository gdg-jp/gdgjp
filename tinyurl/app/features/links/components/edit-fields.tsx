import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Form, useNavigation } from "react-router";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";

import { Input } from "~/components/ui/input";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { SubmitButton } from "~/components/ui/submit-button";
import type { UserChapter } from "~/features/auth/chapter.server";
import type { UserSummary } from "~/features/auth/user.repository";
import type { LinkPermission } from "~/features/links";

export const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function formatDateShort(unix: number): string {
  const d = new Date(unix * 1000);
  const now = new Date();
  return d.getUTCFullYear() === now.getUTCFullYear()
    ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
    : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function userInitials(users: Record<string, UserSummary>, id: string): string {
  const u = users[id];
  const source = u?.name || u?.email || id;
  const parts = source.split(/\s+|@/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export function shortHostOf(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return base.replace(/^https?:\/\//, "");
  }
}

export function faviconUrl(url: string): string | null {
  const host = hostnameOf(url);
  if (!host) return null;
  return `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
}

export function PermissionRow({
  permission,
  editable,
  chapterNameById,
}: {
  permission: LinkPermission;
  editable: boolean;
  chapterNameById: Record<string, string>;
}) {
  const navigation = useNavigation();
  const submittingPermissionId = navigation.formData?.get("permissionId");
  const submittingIntent = navigation.formData?.get("intent");
  const isThisRow = submittingPermissionId === String(permission.id);
  const isUpdating = isThisRow && submittingIntent === "updatePermissionRole";
  const isRemoving = isThisRow && submittingIntent === "removePermission";
  const label =
    permission.principalType === "chapter"
      ? (chapterNameById[permission.principalId] ?? `Chapter #${permission.principalId}`)
      : permission.principalId;
  const principalLabel = permission.principalType === "chapter" ? "Chapter" : "Email";
  return (
    <div className="flex items-center gap-3 border-b py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{principalLabel}</p>
      </div>
      {editable ? (
        <>
          <Form method="post" className="flex items-center gap-2">
            <input type="hidden" name="intent" value="updatePermissionRole" />
            <input type="hidden" name="permissionId" value={permission.id} />
            <Select name="role" defaultValue={permission.role}>
              <SelectTrigger className="h-8 w-[110px]" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="editor">Editor</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
              </SelectContent>
            </Select>
            <SubmitButton variant="ghost" size="sm" pending={isUpdating} pendingLabel="Saving">
              Save
            </SubmitButton>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="removePermission" />
            <input type="hidden" name="permissionId" value={permission.id} />
            <SubmitButton
              variant="ghost"
              size="icon-sm"
              aria-label="Remove"
              pending={isRemoving}
              pendingLabel="Removing"
            >
              <Trash2 className="size-4 text-destructive" />
            </SubmitButton>
          </Form>
        </>
      ) : (
        <Badge variant="secondary">{permission.role}</Badge>
      )}
    </div>
  );
}

export function ShareForm({ chapters }: { chapters: UserChapter[] }) {
  const navigation = useNavigation();
  const isSharing =
    navigation.state !== "idle" && navigation.formData?.get("intent") === "addPermission";
  const [principalType, setPrincipalType] = useState<"user" | "chapter">("chapter");
  const [chapterId, setChapterId] = useState<string>(
    chapters[0] ? String(chapters[0].chapterId) : "",
  );
  const [email, setEmail] = useState("");
  return (
    <Form
      method="post"
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 rounded-md border bg-card p-3 sm:grid-cols-[140px_minmax(0,1fr)_120px_auto]"
    >
      <input type="hidden" name="intent" value="addPermission" />
      <input type="hidden" name="principalType" value={principalType} />
      <Select
        value={principalType}
        onValueChange={(v) => setPrincipalType(v as "user" | "chapter")}
      >
        <SelectTrigger size="sm" className="w-full min-w-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="user">Email</SelectItem>
          <SelectItem value="chapter" disabled={chapters.length === 0}>
            Chapter
          </SelectItem>
        </SelectContent>
      </Select>
      {principalType === "user" ? (
        <Input
          type="email"
          name="principalId"
          placeholder="alice@example.com"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      ) : (
        <>
          <input type="hidden" name="principalId" value={chapterId} />
          <Select value={chapterId} onValueChange={setChapterId}>
            <SelectTrigger size="sm" className="w-full min-w-0">
              <SelectValue placeholder="Choose a chapter" />
            </SelectTrigger>
            <SelectContent>
              {chapters.map((c) => (
                <SelectItem key={c.chapterId} value={String(c.chapterId)}>
                  {c.chapterSlug}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      )}
      <Select name="role" defaultValue="viewer">
        <SelectTrigger size="sm" className="w-full min-w-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="viewer">Viewer</SelectItem>
          <SelectItem value="editor">Editor</SelectItem>
        </SelectContent>
      </Select>
      <SubmitButton
        size="sm"
        className="max-w-full"
        pending={isSharing}
        pendingLabel="Sharing"
        disabled={principalType === "chapter" ? chapterId === "" : email.trim() === ""}
      >
        Share
      </SubmitButton>
    </Form>
  );
}

export function FloatingBar({ onDiscard, isSaving }: { onDiscard: () => void; isSaving: boolean }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 px-4 md:left-60">
      <div className="pointer-events-auto mx-auto flex max-w-6xl items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 shadow-lg">
        <p className="text-sm font-medium">Unsaved changes</p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onDiscard} disabled={isSaving}>
            Discard
          </Button>
          <SubmitButton form="link-update" size="sm" pending={isSaving} pendingLabel="Saving…">
            {isSaving ? "Saving…" : "Save changes"}
          </SubmitButton>
        </div>
      </div>
    </div>
  );
}
