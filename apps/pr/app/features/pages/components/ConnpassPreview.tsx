import { Button, Card, FormField, Heading, Input, Stack, Text } from "@gdgjp/design-system";
import { useState } from "react";
import { Form } from "react-router";

// A frame shaped like connpass's description column (no sanitizer: the renderer guarantees it).
const FRAME_CSS =
  "body{margin:0;padding:16px;font-family:'Hiragino Sans','Noto Sans JP',sans-serif;font-size:15px;line-height:1.8;color:#333;}a{color:#1a73e8;}img{max-width:100%;height:auto;}";

type Props = {
  html: string;
  warnings: string[];
  imageSlots: { id: string; purpose: string; text: string }[];
  imageUrls: Record<string, string | null>;
  busy: boolean;
};

/** connpass-like preview at 1000 / 390 px, the images to supply, and "copy the HTML". */
export function ConnpassPreview({ html, warnings, imageSlots, imageUrls, busy }: Props) {
  const [width, setWidth] = useState<1000 | 390>(1000);
  return (
    <Card>
      <Stack>
        <div className="flex flex-wrap items-center gap-2">
          <Heading level={2} className="text-lg">
            connpass のプレビュー
          </Heading>
          <Button
            type="button"
            size="sm"
            variant={width === 1000 ? "primary" : "outline"}
            onClick={() => setWidth(1000)}
          >
            1000 px
          </Button>
          <Button
            type="button"
            size="sm"
            variant={width === 390 ? "primary" : "outline"}
            onClick={() => setWidth(390)}
          >
            390 px
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void navigator.clipboard?.writeText(html)}
          >
            HTML をコピー
          </Button>
        </div>
        {warnings.length ? <Text tone="muted">描画の注意: {warnings.join(" / ")}</Text> : null}
        <div className="overflow-x-auto rounded-md border border-border">
          <iframe
            title="connpass のプレビュー"
            sandbox=""
            srcDoc={`<!doctype html><meta charset="utf-8"><style>${FRAME_CSS}</style>${html}`}
            style={{ width, height: 900, border: 0, display: "block" }}
          />
        </div>
        {imageSlots.length ? (
          <Form method="post">
            <Stack>
              <Heading level={3} className="text-base">
                要る画像
              </Heading>
              {imageSlots.map((slot) => (
                <FormField
                  key={slot.id}
                  label={`${slot.purpose}（${slot.id}）`}
                  description={slot.text}
                >
                  <Input name={`image:${slot.id}`} defaultValue={imageUrls[slot.id] ?? ""} />
                </FormField>
              ))}
              <div>
                <Button
                  type="submit"
                  name="intent"
                  value="page-images"
                  variant="outline"
                  loading={busy}
                >
                  画像を入れて新しい版にする
                </Button>
              </div>
            </Stack>
          </Form>
        ) : null}
      </Stack>
    </Card>
  );
}
