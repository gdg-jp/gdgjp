# Write request validation

An organizer who may write a group still gets 400 with a stable error code when the
request body is malformed. Validation runs after authorization and before the job is
inserted, so a rejected request leaves no job, no stored image, and no connpass.com
traffic.

## Sub-features

- `connpass-write-validation` checks every validated write route for its 400 error codes:
  event create (`title_required`, `unsupported_event_fields:<keys>`,
  `invalid_event_fields:<keys>`), event update (`invalid_body`, `event_fields_required`),
  sub-event create (`title_required`), survey (`invalid_questions`), conference, messages,
  participant, and voucher bodies (`invalid_body`), and event image (`invalid_event_image`).

## How to get to it (user POV)

An organizer's CLI or agent sends a malformed body to a write route of an allowlisted
group in its chapter. HTTP only; drive it with curl.

## Driving it with HTTP (curl)

Preconditions: the seed is applied and the identity gate passed. Use identity
`e2e-organizer` and group `verify-chapter10` for every request; paths below are relative to
`/api/groups/verify-chapter10`. Send JSON bodies with `content-type: application/json`
exactly as written. Record the job count.

- **Create event.**
  `POST /events` with `{}` returns `400` `{"error":"title_required"}`.
  `POST /events` with `{"title":"   "}` returns `400` `{"error":"title_required"}`.
  `POST /events` with the raw body `not json` returns `400` `{"error":"title_required"}`.
  `POST /events` with `{"title":"Verify","venue":"Hall"}` returns `400`
  `{"error":"unsupported_event_fields:venue"}`.
  `POST /events` with `{"title":"Verify","capacity":"ten"}` returns `400`
  `{"error":"invalid_event_fields:capacity"}`.
  `POST /events` with `{"title":"Verify","speakerIds":[1]}` returns `400`
  `{"error":"invalid_event_fields:speakerIds"}`.
- **Update event.**
  `PATCH /events/900001` with `{}` returns `400` `{"error":"event_fields_required"}`.
  `PATCH /events/900001` with the raw body `not json` returns `400` `{"error":"invalid_body"}`.
  `PATCH /events/900001` with `{"foo":1}` returns `400` `{"error":"unsupported_event_fields:foo"}`.
  `PATCH /events/900001` with `{"hashtag":1,"capacity":"ten"}` returns `400`
  `{"error":"invalid_event_fields:hashtag,capacity"}`.
- **Sub-event.** `POST /events/900001/sub-events` with `{}` and with `{"title":"   "}` each
  return `400` `{"error":"title_required"}`.
- **Survey.** `PUT /events/900001/survey` with `{}`, with
  `{"questions":[{"title":"Q","answerType":"unknown","required":true}]}`, and with
  `{"questions":[{"title":"Q","answerType":"radio"}]}` each return `400`
  `{"error":"invalid_questions"}`.
- **Conference.** `PUT /events/900001/conference` with `{"lpUrl":"https://example.com"}` and
  with `{"isActive":"true"}` each return `400` `{"error":"invalid_body"}`.
- **Message.** `POST /events/900001/messages` with `{"subject":"S"}` and with
  `{"subject":1,"body":"B"}` each return `400` `{"error":"invalid_body"}`.
- **Participant.** `PATCH /events/900001/participants/p1` with the JSON body `null` and with
  the JSON body `"text"` each return `400` `{"error":"invalid_body"}`.
- **Voucher.** `POST /events/900001/vouchers` with
  `{"name":"V","quantity":"1","participationTypeIds":["t1"]}` and with
  `{"name":"V","quantity":1,"participationTypeIds":[1]}` each return `400`
  `{"error":"invalid_body"}`. `PATCH /events/900001/vouchers/v1` with `{"name":"V"}` returns
  `400` `{"error":"invalid_body"}`.
- **Image.** `POST /events/900001/image` as multipart with field `image` =
  `<ready.json.source>/.agents/skills/verify-connpass/fixtures/not-an-image.txt;type=text/plain`
  returns `400` `{"error":"invalid_event_image"}`. Create a 1048577-byte file in the journey's
  evidence directory with `head -c 1048577 /dev/zero > oversize.png` and send it as
  `image=@oversize.png;type=image/png`; it returns `400` `{"error":"invalid_event_image"}`.
  A multipart body with only the field `other=1` returns `400` `{"error":"invalid_event_image"}`.
- **Independent read-back.** The job count is unchanged.
  `SELECT COUNT(*) AS n FROM jobs WHERE created_by = 'e2e-organizer-user'` returns `0`.
  No `connpass session:` line appears in `ready.json.evidence/server.log` during the journey.
- **Evidence.** Save a table of method, path, exact request body, status, and response body,
  plus the SQL output, under `ready.json.evidence/connpass-write-validation/`.

## Gotchas

- Every body above must stay invalid. The organizer is authorized, so a body that passes
  validation enqueues a job that runs at once against connpass.com. Never "fix" a body to
  see a 202.
- `publish`, `copy`, `cancel`, `DELETE /events/:eventId`, `DELETE /sub-events/:subEventId`,
  and `DELETE /vouchers/:voucherId` have no body validation. Any authorized request to them
  creates a job. They have no journey here.
- Do not send `null` for `registrationOpenAt`, `registrationCloseAt`, or
  `lotteryPublishDate` as a validation probe. The OpenAPI schema declares them nullable, but
  the current validator rejects `null` with `invalid_event_fields`. A fix would turn that
  probe into a real job.
- An image body that is not multipart (for example JSON) makes the request fail with a
  500 rather than a 400. Do not use it as a validation probe; record it as a defect if seen.
- The voucher `PATCH` must use the organizer and the voucher route exactly as written.
  `DELETE` on the same path as the organizer creates a job.
