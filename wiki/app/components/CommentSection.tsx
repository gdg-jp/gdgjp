import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";
import CommentEditor from "~/components/CommentEditor";
import type { CommentThread } from "~/components/CommentItem";
import CommentItem from "~/components/CommentItem";

interface CommentSectionProps {
  comments: CommentThread[];
  pageId: string;
  pageSlug: string;
  currentUserId: string;
  userRole: string;
}

export default function CommentSection({
  comments,
  pageId,
  pageSlug,
  currentUserId,
  userRole,
}: CommentSectionProps) {
  const { t } = useTranslation("common");
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state !== "idle";

  const [pendingReplyId, setPendingReplyId] = useState<string | null>(null);

  const topLevel = comments.filter((c) => c.parentId === null);
  const totalCount = comments.length;

  function handleAddComment(contentJson: string) {
    fetcher.submit(
      { intent: "addComment", pageId, contentJson },
      { method: "post", action: "/api/comments" },
    );
  }

  function handleAddReply(parentCommentId: string, contentJson: string) {
    fetcher.submit(
      { intent: "addReply", parentCommentId, pageId, pageSlug, contentJson },
      { method: "post", action: "/api/comments" },
    );
    setPendingReplyId(null);
  }

  function handleDelete(commentId: string) {
    fetcher.submit(
      { intent: "deleteComment", commentId },
      { method: "post", action: "/api/comments" },
    );
  }

  function handleToggleReaction(commentId: string, emoji: string) {
    fetcher.submit(
      { intent: "toggleReaction", commentId, emoji },
      { method: "post", action: "/api/comments" },
    );
  }

  return (
    <div>
      <h2 className="mb-6 text-lg font-semibold text-gray-900">
        {t("wiki.comment.heading")} · {totalCount}
      </h2>

      <div className="mb-8">
        <CommentEditor
          onSubmit={handleAddComment}
          onCancel={() => {}}
          isSubmitting={isSubmitting}
        />
      </div>

      {topLevel.length > 0 && (
        <div className="space-y-6">
          {topLevel.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              currentUserId={currentUserId}
              userRole={userRole}
              depth={0}
              onReply={handleAddReply}
              onDelete={handleDelete}
              onToggleReaction={handleToggleReaction}
              pendingReplyId={pendingReplyId}
              setPendingReplyId={setPendingReplyId}
              isSubmittingReply={isSubmitting}
            />
          ))}
        </div>
      )}
    </div>
  );
}
