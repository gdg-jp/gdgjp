import { Button, Card, Heading, Stack } from "@gdgjp/design-system";
import { useCallback } from "react";
import { useFetcher } from "react-router";
import { GoogleDrivePickerButton } from "./google-drive-picker";

type GoogleConnectionInfo = {
  adminUserId: string | null;
  adminEmail: string | null;
  isCurrentUserAdmin: boolean;
  templateGranted: boolean;
  folderId: string | null;
  folderName: string | null;
  pickerAppId: string;
  pickerApiKey: string;
  templateSpreadsheetId: string;
};

export function GoogleConnectionCard({
  eventId,
  google,
}: {
  eventId: string;
  google: GoogleConnectionInfo;
}) {
  const fetcher = useFetcher<{ error?: string; ok?: boolean }>();

  const getAccessToken = useCallback(async () => {
    const res = await fetch(`/events/${eventId}/google`, {
      method: "POST",
      body: new URLSearchParams({ intent: "access-token" }),
    });
    const json = (await res.json()) as { accessToken?: string; error?: string };
    if (!res.ok || !json.accessToken) {
      throw new Error(json.error ?? "アクセストークンの取得に失敗しました");
    }
    return json.accessToken;
  }, [eventId]);

  return (
    <Card className="space-y-4">
      <Stack>
        <Heading level={2}>Google連携</Heading>
        <p className="text-sm text-muted">
          スプレッドシートへの反映には、イベント管理者本人のGoogleアカウントとの連携が必要です。
        </p>
      </Stack>
      <Stack className="text-sm">
        {!google.adminUserId ? (
          <div className="space-y-2">
            <p className="text-muted">まだGoogle連携されていません。</p>
            <Button asChild size="sm" variant="outline">
              <a href={`/google/connect?event_id=${eventId}`}>自分のGoogleアカウントで連携する</a>
            </Button>
          </div>
        ) : !google.isCurrentUserAdmin ? (
          <div className="space-y-2">
            <p>
              連携アカウント: <span className="font-medium">{google.adminEmail ?? "取得中"}</span>
            </p>
            <p className="text-muted">
              テンプレート・フォルダの設定は連携した本人のみ変更できます。自分に切り替えるには再連携してください。
            </p>
            <Button asChild size="sm" variant="outline">
              <a href={`/google/connect?event_id=${eventId}`}>自分で連携し直す</a>
            </Button>
          </div>
        ) : (
          <>
            <p>
              連携アカウント: <span className="font-medium">{google.adminEmail}</span>
            </p>
            <div className="space-y-1">
              <p>テンプレートへのアクセス: {google.templateGranted ? "許可済み" : "未許可"}</p>
              <p className="text-muted">
                <a
                  className="underline"
                  href={`https://docs.google.com/spreadsheets/d/${google.templateSpreadsheetId}/edit`}
                  target="_blank"
                  rel="noreferrer"
                >
                  テンプレートを開いて確認する
                </a>
                （Pickerで同じファイルを選択してください）
              </p>
              <GoogleDrivePickerButton
                mode="template"
                appId={google.pickerAppId}
                pickerApiKey={google.pickerApiKey}
                getAccessToken={getAccessToken}
                label={google.templateGranted ? "テンプレートを選び直す" : "テンプレートを選択"}
                onPicked={(item) => {
                  fetcher.submit(
                    { intent: "grant-template", fileId: item.id },
                    { method: "post", action: `/events/${eventId}/google` },
                  );
                }}
              />
            </div>
            <div className="space-y-1">
              <p>共有フォルダ: {google.folderName ?? "未設定"}</p>
              <GoogleDrivePickerButton
                mode="folder"
                appId={google.pickerAppId}
                pickerApiKey={google.pickerApiKey}
                getAccessToken={getAccessToken}
                label={google.folderId ? "フォルダを選び直す" : "フォルダを選択"}
                onPicked={(item) => {
                  fetcher.submit(
                    { intent: "set-folder", folderId: item.id },
                    { method: "post", action: `/events/${eventId}/google` },
                  );
                }}
              />
            </div>
            {fetcher.data?.error ? (
              <p className="text-sm text-danger" role="alert">
                {fetcher.data.error}
              </p>
            ) : null}
          </>
        )}
      </Stack>
    </Card>
  );
}
