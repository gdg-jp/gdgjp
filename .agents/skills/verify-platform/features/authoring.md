# Wiki authoring and comments

An author creates a page, edits its contents, and submits a comment that remains
after reload.

## Sub-features

- `wiki-authoring` creates a page and persists a later edit.
- `wiki-comment` submits a comment and resets the comment editor after success.

## How to get to it (user POV)

Open `http://localhost:6177/s/gdg-jp/wiki/new` as the author. Open the resulting
page and choose **Edit** to change it. Use the page's comment editor to comment.

## Driving it with Orca Browser

Preconditions: set the `author` Wiki fixture in its own isolated profile. Confirm
that the selected fixture identifies `e2e-author-user-id`. Choose a unique title,
body marker, and comment marker for this run.

- Create. Start capture and navigate to the new-page route. Use the snapshot ref
  for the Japanese title field, whose name is `titleJa` and placeholder is
  **Title (Japanese)** or **タイトル（日本語）**. Enter the unique title. Focus the Markdown editor for
  `editor-ja` and type the body marker through Orca. Click **Publish** or **公開**. Require a
  successful form response and the resulting page with that title and body.
  Record the returned page URL and page ID. Reload and require the same values.
- Edit. Open the page's `/edit` route through its edit control. Change the title
  or body using actual controls. Click **Save** or **保存**. Require the changed page after
  the form response and after another reload. Keep the old and new expected
  markers in the journey record.
- Comment. Open the page and focus the visible comment editor. This editor is
  TipTap, unlike the Markdown page editor. Type the comment marker and click
  **Comment** or **コメントする**. Require a successful POST `/api/comments`, a visible comment,
  and an empty comment editor after success. Reload and require the comment to
  remain. Do not create the expected comment through HTTP.

## Gotchas

The `author` fixture bypasses Accounts OIDC. Use the Accounts journey to verify
that flow. The two editors have different controls. Follow their actual snapshot
refs rather than assuming both are TipTap. Record a missing editor or an unexpected
redirect as a failed precondition. All created pages remain inside scratch D1 and
are removed by helper cleanup. External translation, indexing, and notifications
are outside this journey's acceptance.
