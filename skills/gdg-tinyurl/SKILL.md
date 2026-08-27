---
name: gdg-tinyurl
description: Use the gdg CLI to manage short links, custom domains, folders, tags, attribution campaigns, channels, sources, and analytics on url.gdgs.jp. Apply to `gdg tinyurl` tasks.
---

# GDG TinyURL CLI

Use `gdg tinyurl` for URL-shortener resources. Responses are indented JSON.

## Workflow

1. Check `gdg tinyurl --help` and leaf-command help. Prefer the installed CLI and current source
   over older examples because this command surface evolves.
2. Ensure `gdg login` has been completed. `GDG_TINYURL_URL` is only for an intentionally selected
   development endpoint; production defaults to `https://url.gdgs.jp`.
3. Discover IDs with list/get commands. Numeric domain, folder, tag, campaign, channel, and source
   IDs must be positive integers; link IDs are opaque strings.
4. Use the smallest resource hierarchy that matches the request: domains own slugs, folders
   organize links, tags label them, and campaign channel/source records provide attribution.
5. After create/update/archive/restore/delete, inspect and report the returned state.

## Commands

### Links, tags, folders, and domains

```sh
gdg tinyurl links list [--folder-id ID] [--tag-id ID] [--limit N] [--cursor CURSOR]
gdg tinyurl links create --domain-id ID --slug SLUG --url URL \
  [--title TITLE] [--folder-id ID] [--campaign-channel-id ID] \
  [--visibility private|public] [--tag-id ID] [--new-tag NAME] [--share TYPE:ID:ROLE]
gdg tinyurl links get LINK_ID
gdg tinyurl links update LINK_ID [--slug SLUG] [--url URL] [--title TITLE] \
  [--folder-id ID] [--campaign-channel-id ID] [--visibility private|public] \
  [--tag-id ID] [--new-tag NAME] [--share TYPE:ID:ROLE]
gdg tinyurl links delete LINK_ID

gdg tinyurl tags list|create|update|delete
gdg tinyurl folders list|get|create|update|delete
gdg tinyurl domains list|get|create|sync|delete
```

Use leaf help for required positional IDs and flags. Notable create forms are:

```sh
gdg tinyurl tags create --name NAME [--color COLOR]
gdg tinyurl folders create --name NAME [--parent-id ID]
gdg tinyurl domains create --hostname HOSTNAME --chapter-id ID
gdg tinyurl domains sync DOMAIN_ID
```

Tags are personal. Tag update and folder update require `--name`; folder deletion requires an empty
folder. Domain delete and link delete are soft deletes.

### Campaign attribution

```sh
gdg tinyurl campaigns list [--include-archived] [--limit N] [--cursor C]
gdg tinyurl campaigns create --name NAME --code CODE --chapter-id ID \
  [--chapter-id ID] [--default-destination-url URL]
gdg tinyurl campaigns get CAMPAIGN_ID
gdg tinyurl campaigns update CAMPAIGN_ID [--name NAME] [--code CODE] \
  [--chapter-id ID] [--default-destination-url URL]
gdg tinyurl campaigns archive|restore CAMPAIGN_ID

gdg tinyurl campaigns channels list|create|update|archive|restore --campaign-id ID ...
gdg tinyurl campaigns sources list|create|update|archive|restore \
  --campaign-id ID --channel-id ID ...

gdg tinyurl campaigns analytics CAMPAIGN_ID --from ISO_INSTANT --to ISO_INSTANT \
  [--bucket hour|day]
```

Channel create requires `--campaign-id`, `--name`, and `--code`. Source create additionally
requires `--channel-id`; update/archive/restore use the corresponding `--channel-id` and
`--source-id`. List archived records before restoring them.

## Important behavior

- Every list command accepts `--limit` and `--cursor`, returns `nextCursor`, and does not auto-page.
- Link `--share` values use `TYPE:ID:ROLE`; never invent a principal or role.
- `links update` changes only explicitly supplied fields. Repeated `--tag-id`, `--new-tag`, and
  `--share` values form the submitted collections.
- Domain registration changes DNS/provider-facing state. Confirm hostname and chapter ownership.
- Analytics requires an explicit ordered ISO-instant window of at most 366 days.
- The current CLI performs domain create/sync synchronously and has no `tinyurl jobs` command or
  `--wait` flag. Do not copy stale examples that use them.
