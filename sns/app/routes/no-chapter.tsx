export default function NoChapter() {
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-xl font-bold">SNS Manager へのアクセス権がありません</h1>
      <p className="mt-3 text-muted-foreground">
        Accounts でOrganizerになるか、対象チャプターのOrganizerにSNS
        Contributor権限を依頼してください。
      </p>
    </main>
  );
}
