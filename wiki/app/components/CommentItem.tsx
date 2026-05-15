import { MessageSquare, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import ConfirmDialog from "~/components/ConfirmDialog";
import type { ReactionGroup } from "~/components/EmojiReactionBar";
import EmojiReactionBar from "~/components/EmojiReactionBar";
import type { TipTapDoc } from "~/components/TipTapRenderer";
import { TipTapRenderer } from "~/components/TipTapRenderer";
import CommentEditor from "./CommentEditor";

export interface CommentThread {
  id: string;
  authorId: string;
  authorName: string;
  authorImage: string | null;
  parentId: string | null;
  contentJson: string;
  deletedAt: Date | null;
  createdAt: Date;
  reactions: ReactionGroup[];
  replies: CommentThread[];
}

interface CommentItemProps {
  comment: CommentThread;
  currentUserId: string;
  userRole: string;
  depth: 0 | 1;
  onReply: (parentId: string, contentJson: string) => void;
  onDelete: (commentId: string) => void;
  onToggleReaction: (commentId: string, emoji: string) => void;
  pendingReplyId: string | null;
  setPendingReplyId: (id: string | null) => void;
  isSubmittingReply: boolean;
}

function RelativeTime({ date }: { date: Date }) {
  const { t } = useTranslation("common");
  const now = Date.now();
  const diff = now - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (diff < 60000) return <span>{t("time.just_now")}</span>;
  if (hours < 1) return <span>{t("time.minutes_ago", { count: minutes })}</span>;
  if (days < 1) return <span>{t("time.hours_ago", { count: hours })}</span>;
  return <span>{t("time.days_ago", { count: days })}</span>;
}

function AuthorAvatar({ name, image }: { name: string; image: string | null }) {
  if (image) {
    return (
      <img
        src={image}
        alt={name}
        className="h-8 w-8 rounded-full object-cover"
        referrerPolicy="no-referrer"
      />
    );
  }
  const initials = name
    .split(" ")
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
      {initials}
    </div>
  );
}

export default function CommentItem({
  comment,
  currentUserId,
  userRole,
  depth,
  onReply,
  onDelete,
  onToggleReaction,
  pendingReplyId,
  setPendingReplyId,
  isSubmittingReply,
}: CommentItemProps) {
  const { t } = useTranslation("common");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const isDeleted = !!comment.deletedAt;
  const canDelete = !isDeleted && (comment.authorId === currentUserId || userRole === "admin");
  const showReplyEditor = pendingReplyId === comment.id;

  let parsedDoc: TipTapDoc | null = null;
  if (!isDeleted) {
    try {
      parsedDoc = JSON.parse(comment.contentJson) as TipTapDoc;
    } catch {
      /* ignore */
    }
  }

  return (
    <div id={`comment-${comment.id}`} className="flex gap-3">
      <div className="flex-shrink-0">
        <AuthorAvatar name={comment.authorName} image={comment.authorImage} />
      </div>

      <div className="min-w-0 flex-1">
        {/* Header */}
        <div className="mb-1 flex items-baseline gap-2">
          <span className="text-sm font-medium text-gray-900">{comment.authorName}</span>
          <span className="text-xs text-gray-400">
            <RelativeTime date={comment.createdAt} />
          </span>
        </div>

        {/* Content */}
        {isDeleted ? (
          <p className="text-sm italic text-gray-400">{t("wiki.comment.deleted")}</p>
        ) : parsedDoc ? (
          <div className="text-sm text-gray-800">
            <TipTapRenderer doc={parsedDoc} />
          </div>
        ) : (
          <p className="text-sm text-gray-800">{comment.contentJson}</p>
        )}

        {/* Bottom bar */}
        {!isDeleted && (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <EmojiReactionBar
              reactions={comment.reactions}
              onToggleReaction={(emoji) => onToggleReaction(comment.id, emoji)}
            />

            {depth === 0 && (
              <button
                type="button"
                onClick={() => setPendingReplyId(showReplyEditor ? null : comment.id)}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
              >
                <MessageSquare size={13} />
                {t("wiki.comment.reply")}
              </button>
            )}

            {canDelete && (
              <button
                type="button"
                onClick={() => setDeleteDialogOpen(true)}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500"
              >
                <Trash2 size={13} />
                {t("wiki.comment.delete")}
              </button>
            )}
          </div>
        )}

        {/* Inline reply editor */}
        {showReplyEditor && (
          <div className="mt-3">
            <CommentEditor
              onSubmit={(json) => onReply(comment.id, json)}
              onCancel={() => setPendingReplyId(null)}
              isSubmitting={isSubmittingReply}
            />
          </div>
        )}

        {/* Replies (depth=1, no reply button on children) */}
        {depth === 0 && comment.replies.length > 0 && (
          <div className="mt-4 space-y-4 border-l-2 border-gray-100 pl-4">
            {comment.replies.map((reply) => (
              <CommentItem
                key={reply.id}
                comment={reply}
                currentUserId={currentUserId}
                userRole={userRole}
                depth={1}
                onReply={onReply}
                onDelete={onDelete}
                onToggleReaction={onToggleReaction}
                pendingReplyId={pendingReplyId}
                setPendingReplyId={setPendingReplyId}
                isSubmittingReply={isSubmittingReply}
              />
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleteDialogOpen}
        title={t("wiki.comment.delete_confirm_title")}
        message={t("wiki.comment.delete_confirm_message")}
        confirmLabel={t("wiki.comment.delete")}
        cancelLabel={t("cancel")}
        destructive
        onConfirm={() => {
          setDeleteDialogOpen(false);
          onDelete(comment.id);
        }}
        onCancel={() => setDeleteDialogOpen(false)}
      />
    </div>
  );
}
