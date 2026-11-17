# Accounts and Wiki feature map

Drive these journeys in the isolated stack from [verify-platform](../SKILL.md).
Current-run status and evidence belong in [coverage.json](../coverage.json).
Every journey starts as `NOT VERIFIED`; a source recipe is not execution evidence.

| Journey IDs | Feature | Identity |
| --- | --- | --- |
| `accounts-signin`, `accounts-continuation` | [Sign-in and authorization continuation](accounts.md) | Anonymous |
| `accounts-oidc`, `accounts-signout` | [Local OIDC and sign-out](accounts.md) | Accounts session only |
| `wiki-authoring`, `wiki-comment` | [Create, edit, and comment](authoring.md) | Wiki author |
| `wiki-search` | [Keyword search](search.md) | Author and member |
| `wiki-runner-admin`, `wiki-space-settings` | [Administrator boundaries](administration.md) | Wiki admin and member |
| `wiki-viewer` | [Viewer permissions](../../verify-wiki/features/viewer.md) | Wiki member |
| `wiki-redaction` | [Markdown redaction](../../verify-wiki/features/redaction.md) | Wiki author without organizer access |
| `wiki-sharing` | [Sharing dialog](../../verify-wiki/features/sharing.md) | Wiki author |
| `wiki-display` | [Page display settings](../../verify-wiki/features/page-menu.md) | Wiki author |

The last four journeys retain the existing Wiki recipes. Their presence in that
map does not establish their execution at the current source snapshot. Use the
platform helper's fixtures and evidence directory when executing them here.

Run sign-out last in its OIDC profile. Keep the Accounts OIDC profile separate from Wiki fixture identities. Restore a page's sharing precondition
before the next journey. Do not let one journey's permission change invalidate
another journey without recording that change.

The map lists selected user entry points. It does not cover every account setting,
Wiki mutation, locale, browser size, or failure mode. Seeded Playwright action
sequences are separate regression evidence and do not replace these Orca journeys.
