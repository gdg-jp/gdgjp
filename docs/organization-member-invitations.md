# Organization member invitations

The `Sync organization invitations` workflow runs every Monday at 00:17 JST. It invites every
member of `gdsc-osaka` who is not already a member of `gdg-jp` and has no pending, failed, or
expired invitation. It can also be started manually with dry-run enabled by default.

Scheduled runs invite only new members. Users with a failed or expired invitation are not invited
again. For an intentional manual retry, enable `reinvite_failed`; this option is disabled by
default and does not affect scheduled runs.

## Required secrets

Configure these Actions secrets in the repository settings:

- `SOURCE_ORG_MEMBERS_TOKEN`: a token that can list every `gdsc-osaka` member, including members
  whose organization membership is private. For a fine-grained personal access token, grant
  `gdsc-osaka` organization **Members: read** permission.
- `TARGET_ORG_MEMBERS_TOKEN`: a token that can list members and invitations and create invitations
  in `gdg-jp`. For a fine-grained personal access token, grant `gdg-jp` organization
  **Members: write** permission. The token owner must be allowed to invite organization members.

Using separate tokens keeps the source organization read-only. A single classic personal access
token may be stored in both secrets if its owner is a `gdsc-osaka` member and a `gdg-jp` owner and
the token has the `admin:org` scope. A future GitHub App integration should mint short-lived
installation tokens during each run instead of storing installation tokens as repository secrets.

## First run

1. Add both repository secrets.
2. Open **Actions → Sync organization invitations → Run workflow**.
3. Leave **dry_run** enabled and confirm the candidate list in the job summary.
4. Run it again with **dry_run** disabled to send invitations.

Leave **reinvite_failed** disabled for normal runs. Enable it only when failed or expired
invitations should be sent again deliberately.

Scheduled runs send invitations automatically. GitHub may reject invitations when the target
organization has reached its member limit or when its invitation policy does not allow the token
owner to invite members; those errors fail the workflow and remain visible in its logs.
