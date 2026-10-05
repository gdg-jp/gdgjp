import { useState } from "react";
import type { CollabPeer } from "~/features/editor/use-collab-editor";
import { hashColorTw } from "~/lib/color-utils";

const MAX_VISIBLE = 5;

const LANG_COLORS: Record<string, string> = {
  ja: "bg-gdg-red",
  en: "bg-gdg-blue",
};

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

interface PresenceAvatarsProps {
  peers: CollabPeer[];
}

export default function PresenceAvatars({ peers }: PresenceAvatarsProps) {
  if (peers.length === 0) return null;

  const visible = peers.slice(0, MAX_VISIBLE);
  const overflow = peers.length - MAX_VISIBLE;

  return (
    <div className="flex items-center -space-x-1.5">
      {visible.map((peer) => (
        <Avatar key={peer.clientId} peer={peer} />
      ))}
      {overflow > 0 && (
        <span className="relative z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 border-border bg-neutral text-xs font-medium text-muted">
          +{overflow}
        </span>
      )}
    </div>
  );
}

function Avatar({ peer }: { peer: CollabPeer }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const langDot = LANG_COLORS[peer.activeLang] ?? "bg-gdg-blue";

  return (
    <button
      type="button"
      className="relative z-10 appearance-none border-0 bg-transparent p-0"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onFocus={() => setShowTooltip(true)}
      onBlur={() => setShowTooltip(false)}
      aria-label={peer.user.name}
    >
      {peer.user.image ? (
        <img
          src={peer.user.image}
          alt={peer.user.name}
          className="h-7 w-7 rounded-full border-2 border-border object-cover"
        />
      ) : (
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-full border-2 border-border text-xs font-medium text-primary-foreground ${hashColorTw(peer.user.id)}`}
        >
          {getInitials(peer.user.name)}
        </span>
      )}
      {/* Language indicator dot */}
      <span
        className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-border ${langDot}`}
      />
      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-2 py-0.5 text-xs text-primary-foreground shadow">
          {peer.user.name}
        </div>
      )}
    </button>
  );
}
