import { Form } from "react-router";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

export function ReceiptUpload() {
  return (
    <Form method="post" encType="multipart/form-data" className="space-y-3 rounded-xl border p-5">
      <input type="hidden" name="intent" value="upload" />
      <div className="space-y-2">
        <Label htmlFor="receipt">領収書 PDF / 写真を追加</Label>
        <Input id="receipt" name="receipt" type="file" accept="application/pdf,image/*" required />
        <p className="text-xs text-muted-foreground">
          アップロード後、Gemini が日付・金額・種別を推定します。必ず確認して保存してください。
        </p>
      </div>
      <Button type="submit">アップロードして抽出</Button>
    </Form>
  );
}
