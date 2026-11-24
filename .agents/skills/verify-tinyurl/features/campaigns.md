# Campaigns, channels, sources, and connpass import

A campaign groups an event's links by acquisition channel (X, Discord, ...) and recurring
source. Members of the campaign's chapters create and edit campaigns, add channels and sources,
create or assign links per channel, read click analytics, and import a connpass participant CSV
to see how attendees discovered the event.

## Sub-features

- `tinyurl-campaigns` empty state, **Create campaign** (**Event name**, chapter access,
  **Short code**, **Default Destination URL**), validation, **Edit campaign**, **Archive** /
  **Restore** with the **Active** / **Archived** tabs, 403 for other chapters.
- `tinyurl-campaign-channels` the default `その他` channel, **Add channel**, **Edit channel**,
  **Source** (**Add source**), **Create link** in a channel with its suggested slug, **Assign links**,
  channel archive.
- `tinyurl-campaign-acquisition` **Import connpass CSV**: question detection, channel mapping,
  unmapped-option validation, save, and the **Acquisition summary**.
- `tinyurl-campaign-channels` the **Clicks** view renders with zero data (click counts are outside
  the map).

## How to get to it (user POV)

Sidebar **Insights**, **Campaigns** (`http://localhost:6169/campaigns`). A campaign card opens
`/campaigns/<id>`, which has **Assign links**, **Add channel**, and the view tabs **Channel**,
**Clicks**, and **Acqquisitions** (spelled so in the UI; `?view=analytics` and
`?view=acquisition`).

## Driving it with Orca Browser

Preconditions: `owner` signed in; cookie jar for `outsider`. [links.md](links.md) ran, so `owner`
has the unclassified, unarchived link titled `Verify random` to assign.

- **Empty.** `goto /campaigns`. Require heading **Campaigns**, the description
  `Organize gdg-verify-tokyo links by event, channel, and source.`, tabs **Active 0** and
  **Archived 0**, **Create your first campaign**, and `Click analytics are available inside each
  campaign.`
- **Create.** Choose **Create campaign**. Require **Event name**, **Chapters with access** showing
  `1 chapters selected`, **Short code** (placeholder `df26`), and **Default Destination URL**. Fill
  `Verify Campaign` and `vt26`, leave the destination empty, and choose **Create campaign**.
  Require the card `Verify Campaign` with badge `vt26`, `1 channels`, `0 links`. D1: `SELECT id,
  name, code, owner_user_id, default_destination_url FROM campaigns` and `SELECT chapter_id FROM
  campaign_chapters` return the campaign and `101`; `SELECT name, code FROM campaign_channels WHERE
  campaign_id = <id>` returns `その他`, `other`.
- **Validation.** Create again with code `vt26` and require the **Error** alert
  `Campaign code “vt26” is already in use.` Create `Bad destination` / `vt27` with
  **Default Destination URL** `http://localhost/event` and require
  `Default destination URL must not resolve to a private or loopback address.` D1 has no `vt27`.
- **Edit.** Choose the pencil **Edit Verify Campaign**, require **Edit campaign**, set
  **Event name** to `Verify Campaign 2026`, and **Save**. Require the new card name and the D1
  `name`.
- **Archive and restore.** Choose **Archive** on the card. Require **Active 0**, **Archived 1**;
  open **Archived**, require the card, choose **Restore**, and require it under **Active** again.
  D1 `archived_at` is non-null, then null.
- **Other chapter.** `curl -s -o /dev/null -w '%{http_code}\n' -b "$EVIDENCE/outsider.jar"
  http://localhost:6169/campaigns/<id>` prints `403`; the outsider's `/campaigns` shows
  **Create your first campaign**.
- **Channels.** Open the campaign. Require the heading `Verify Campaign 2026` with `vt26`,
  `Channel, links, and source performance`, **Channels**, `1 channels`, and the card `その他`
  `other` `0 links · 0 sources`. Choose **Add channel**; the dialog **Add channel** says
  `Create a channel under vt26.` Fill **Display name** `X`, **Code** `x`, and choose **Add**.
  Require the card `X` `x`. Adding code `x` again shows `Channel code “x” is already in use.`
- **Source.** On the `X` card choose **Source**, require **Add source**, fill **Display name**
  `GDG Tokyo` and **Code** `1`, and **Add**. Require `0 links · 1 sources`; expanding the card
  shows the chip `GDG Tokyo 1`. D1: `SELECT name, code FROM campaign_channel_sources` returns it.
- **Create link in channel.** On the `X` card choose **Create link**. Require **Short Link**
  prefilled `vt26x`. Fill **Title** `Campaign X link`, then **Destination URL**
  `https://1.1.1.1/verify-campaign-x`, and **Create link**. D1: `SELECT slug, domain_id,
  campaign_channel_id, owner_chapter_id FROM links WHERE slug = 'vt26x'` returns `vt26x`, `1`, the
  `X` channel id, `101`. On `/links` the link is hidden under the default **Unclassified** filter
  and shown under **All campaigns**.
- **Assign.** Choose **Assign links**, require **Assign links to channels** and
  `Selected links become chapter-owned and are added to this campaign.`, choose channel `X (x)`,
  check `Verify random` (the random-slug link from [links.md](links.md)), and **Assign selected**.
  D1: `SELECT campaign_channel_id, owner_chapter_id FROM links WHERE title = 'Verify random'`
  returns the `X` channel id and `101`. Reopen **Assign links**: `Verify random` is no longer
  listed. Choose channel `X (x)`, check nothing, and choose **Assign selected**; require
  `Select at least one link.` (Submitting without a channel answers a bare 400 page instead.)
- **Edit and archive channel.** Choose the pencil on `X`, require **Edit channel** with
  **Display name**, **Code**, **Order**; set **Display name** `X (Twitter)` and **Save**. Choose
  **Archive X (Twitter)**; the card shows **Archived** and has no **Create link**. Restore it with
  **Restore X (Twitter)**.
- **Clicks view.** Choose **Clicks**. Require the URL `?view=analytics` and the panel with
  **Channel**, **Sources** (`No source data yet.`), and **Links**, all at zero.
- **Acquisition empty.** Choose **Acqquisitions**. Require **Acquisition**,
  `Import a connpass CSV to see how participants discovered this event.`, and
  **Import connpass CSV**.
- **Import.** Choose **Import connpass CSV**. In **connpass CSV**, upload
  [`../fixtures/event_9100001_participants.csv`](../fixtures/event_9100001_participants.csv).
  Require `4 participants`, **Rule-based extraction**, **1. Discovery questions** with
  `どこからこのイベントを知りましたか？` checked, and **2. Campaign channel mappings** rows `X` →
  `X (Twitter)`, `その他` → `その他`, `知人から` → **Select a channel**. **connpass event ID** is
  prefilled `9100001`. Choose **Save and replace acquisition data**. Require the alert
  **Acquisition data could not be saved** with
  `Assign one Campaign channel to these CSV options:` and
  `どこからこのイベントを知りましたか？: 知人から`. Map `知人から` to `その他` and save again. The dialog
  closes; the panel shows **Acquisition summary**, `connpass 9100001`, **Applications** `4`,
  `現地参加` `3`, `配信参加` `1`, **Cancellations** `1`, and the button **Update connpass CSV**.
- **Import read-back.** D1: `SELECT connpass_event_id, imported_by_user_id FROM
  campaign_participant_analytics WHERE campaign_id = <id>` returns `9100001`, `dev-user-owner`;
  `SELECT COUNT(*) AS n FROM campaign_participants WHERE campaign_id = <id>` returns 4.

Evidence: screenshots of the empty list, the campaign card, the channel list with source chip,
the import mapping with the validation alert, and the acquisition summary; the D1 rows above.

## Gotchas

**Create link** on a channel card offers only the default domain (it shows the
`SHORT_URL_BASE` host but saves `domain_id` 1, `gdgs.jp`), so campaign links do not resolve on
the local apex. Verify them through D1, or move one to `localhost:6169/` on its detail page.
A campaign **Default Destination URL** prefills the channel **Create link** dialog and starts a
preview fetch to that destination as soon as the dialog opens; keep it empty in this journey.
Campaign codes are unique per creating user, not per chapter.
The tab label **Acqquisitions** is misspelled in the source; match it literally.
Archived channels stay listed with **Archived**; archived campaigns move to the **Archived** tab.
