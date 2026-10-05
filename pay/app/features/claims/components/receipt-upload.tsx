import { Button, Card, FormField, Input } from "@gdgjp/design-system";
import { Form } from "react-router";

export function ReceiptUpload() {
  return (
    <Card>
      <Form method="post" encType="multipart/form-data" className="space-y-3">
        <input type="hidden" name="intent" value="upload" />
        <FormField
          id="receipt"
          label="領収書 PDF / 写真を追加"
          required
          description={
            <>
              {" "}
              アップロード後、Gemini が日付・金額・種別を推定します。必ず確認して保存してください。{" "}
            </>
          }
        >
          <Input name="receipt" type="file" accept="application/pdf,image/*" required />
        </FormField>
        <Button type="submit" variant="secondary">
          アップロードして抽出
        </Button>
      </Form>
    </Card>
  );
}
