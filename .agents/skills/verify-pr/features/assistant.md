# Assistant thread

Each event's home is a thread with the assistant. People paste pages and files; the Worker
collects them (masking emails and phone numbers) and an `assist` runner job rewrites the brief
and offers buttons. The assistant never acts outside pr.

## Sub-features

- `pr-assistant-source`: a new event shows **秘書です。準備を始めましょう。**; sending
  **秘書へのメッセージ** with `http://127.0.0.1:6162/event` shows **秘書が読んでいます** and a
  link **Verify Meetup**; after the runner posts an `assist` result the thread shows
  **brief を更新しました（版 1）** and offers no button that leaves pr.

## How to get to it (user POV)

`/c/<slug>` (the event's 秘書 tab).

## Driving it with Orca Browser

Preconditions: `lead`, a new event. Fill **秘書へのメッセージ** and click **送る**. Act as the
runner for the `assist` job using the shape in `apps/pr/e2e/assistant.spec.ts`. Read the
stored source text from D1 `campaign_sources` and require `staff@example.com` to be masked.

## Gotchas

Not executed in the recorded run. Only loopback URLs may be pasted; any other URL is fetched
from the public internet by the Worker.
