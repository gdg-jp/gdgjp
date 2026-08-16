# connpass events update: CLI flags that PATCH silently drops

## Summary

`gdg connpass events update` は多数のフィールドフラグを camelCase JSON にして送るが、connpass Worker の PATCH は一部だけをジョブ `request` に残す。残りのフラグはジョブが `succeeded` になってもイベントは変わらない。

## Observed (2026-08-14, event `gdgkwansai` / `403756`)

CLI は次を PATCH body に含めた（モック API で確認）:

- `eventType`, `image`, `allowConflictJoin`, `allowReceipt`
- `invoiceNumber`, `receiptIssuerName`, `receiptIssuerAddress`, `paypalEmail`
- `contactDetails`, `lotteryPublishDate`, `registrationOpenAt`, `registrationCloseAt`

本番で同じフラグだけを `--wait` すると、ジョブは `status: succeeded` で `request: {}`。GET の対応フィールドは変化なし。

`participationTypes` は API が受け付けるが、対応する CLI フラグはない。`--json` / `--from-file` 経由では反映を確認した（参加枠 `587535` の `maxParticipants` が 42 になった）。

## Expected

CLI の help に出るフラグは更新されるか、未実装なら受け付けない（エラーまたは help から外す）。

## Known mapping

CLI 組み立て: `cli/internal/command/connpass_events.go` の `eventFieldFlags.apply`。

PATCH がジョブへ渡すキー（`connpass/app/routes/api.groups.$groupId.events.$eventId.ts` の `action`）:

- `title`, `subtitle`, `description`, `startAt`, `endAt`
- `place`, `address`, `capacity`, `reservedAt`, `registrationEnabled`
- `participationTypes`, `ownerText`, `participantOnlyInfo`, `cancelPolicy`

OpenAPI の `EventFields` には CLI が送って PATCH が捨てるキーも含まれている。
