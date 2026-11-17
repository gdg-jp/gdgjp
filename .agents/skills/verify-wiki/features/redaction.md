# Markdown redaction

## Sub-features

A reader sees permitted Markdown and copies the displayed content. Organizer-only content stays hidden, including when English content falls back to Japanese.

## How to get to it (user POV)

Open an accessible page with an organizer-only block as a user without organizer access. Choose **More actions**, then **Copy page contents**.

## Driving it with Orca browser

Use the author fixture cookie to POST `/s/gdg-jp/wiki/new` with form fields `titleJa=Pstack redaction`, `titleEn=Pstack redaction`, `contentJa=Visible\n\n<acl level="organizer">PRIVATE_SECRET</acl>`, and empty `contentEn`. Send actual newlines in content. Require HTTP 302 and keep the returned Location and `x-wiki-page-id`.

Set the author fixture cookie on the isolated Orca tab. Navigate to the returned page URL with `?lang=en`. Check the visible article contains `Visible` and omits `PRIVATE_SECRET`. Open **More actions** and click **Copy page contents** using current snapshot refs. Read the clipboard through Orca eval when permission permits. Require `Visible` and reject both `PRIVATE_SECRET` and `<acl` in the copied string.

Capture the menu action, resulting clipboard content, and screenshot. The existing recipe is `Markdown copy uses the redacted displayed content and language fallback` in `page-menu.spec.ts`.

## Gotchas

Clipboard permission can be refused by the browser. Report that part as unverified rather than substituting a direct content fetch for the user action. This journey covers one ACL block and one language fallback; it is not exhaustive parser verification.
