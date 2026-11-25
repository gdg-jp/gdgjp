# Legal name and bank account

A member records the legal name and bank account that self claims copy. The page
pre-fills saved values, and the account number is stored encrypted.

## Sub-features

- `pay-profile-save` saves a new profile, shows it pre-filled after reload, rejects whitespace-only fields, and stores the account number as ciphertext.

## How to get to it (user POV)

Choose **口座情報** in the header or on the home page, or follow the **本名と口座情報**
link inside the **口座情報の登録が必要です** notice on an event page. The page heading is
**本名・振込先口座**, with fields **申請者氏名（本名）**, **銀行名**, **支店名**, **口座種別**
(default `普通`), **口座番号**, and the button **保存する**.

## Driving it with Orca Browser

Preconditions: the helper is ready. Use the identity `claimant`, which has no profile
and no claims: `/dev/login?as=claimant&chapter=1:gdg-tokyo:member&return_to=/profile`.

- Empty form. Require heading **本名・振込先口座**, empty **申請者氏名（本名）**, **銀行名**,
  **支店名**, **口座番号**, and **口座種別** set to `普通`. Independent check:
  `pnpm exec wrangler d1 execute gdgjp-pay-db --local --command "SELECT COUNT(*) AS n FROM profiles WHERE user_id = 'dev-user-claimant'"`
  returns `n = 0`. Evidence: snapshot.
- Whitespace rejection. Fill **申請者氏名（本名）** `検証 申請者（架空）`, **銀行名** with a
  single space, **支店名** `検証支店`, **口座番号** `0000003`, and choose **保存する**. Require an
  alert titled `すべての項目を入力してください`, URL `/profile` without `saved=1`, and the
  profile count still `0`.
- Save. Fill **銀行名** `架空検証銀行` and choose **保存する**. Require navigation to
  `/profile?saved=1` and the fields pre-filled with the entered values, including
  **口座番号** `0000003`. Reload and require the same values. Independent check:
  `pnpm exec wrangler d1 execute gdgjp-pay-db --local --command "SELECT legal_name, bank_name, branch_name, account_type, account_number_enc FROM profiles WHERE user_id = 'dev-user-claimant'"`
  returns one row whose `account_number_enc` has the form `<base64>.<base64>` and is not
  `0000003`. Evidence: snapshot after reload, the D1 row with the ciphertext truncated
  to its first 8 characters.
- Update. Change **支店名** to `検証第二支店`, choose **保存する**, and require the new value
  after reload; the D1 row count stays `1` and `branch_name` is `検証第二支店`.

## Gotchas

- Inputs carry `required`, so an empty field is blocked by the browser before the server
  sees it. Use a single space to reach the server-side message; an empty field that only
  shows a native validation bubble does not prove the server check.
- `?saved=1` produces no visible confirmation. Prove the save by the pre-filled values and
  the D1 row.
- The page shows the decrypted account number in plain text to its owner. That is the
  current design; record it only if the run is about privacy.
- Changing the profile does not update existing claims. A self claim copies the name and
  bank at creation time.
- Use only clearly fake bank data. Do not enter a real account number.
