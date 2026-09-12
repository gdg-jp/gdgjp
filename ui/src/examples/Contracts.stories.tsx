import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef, useState } from "react";
import * as UI from "../index.ts";
function ContractExamples() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectOpen, setSelectOpen] = useState(false);
  const [clicks, setClicks] = useState(0);
  const [submitted, setSubmitted] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <main className="gdg-catalog">
      <UI.Heading level={1}>操作契約</UI.Heading>
      <UI.Text>連続操作、必須入力、リンク合成を確認する例です。</UI.Text>
      <UI.Card>
        <UI.Stack>
          <UI.Button asChild disabled>
            {/* biome-ignore lint/a11y/useValidAnchor: test disabled link navigation and child click composition. */}
            <a href="#unexpected" onClick={() => setClicks((c) => c + 1)}>
              無効なリンク
            </a>
          </UI.Button>
          <output aria-label="クリック回数">{clicks}</output>
          <UI.Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <UI.DialogTrigger asChild>
              <UI.Button>連続開閉Dialog</UI.Button>
            </UI.DialogTrigger>
            <UI.DialogContent>
              <UI.DialogTitle>再オープン</UI.DialogTitle>
              <UI.DialogDescription>退出中の再オープンを確認します。</UI.DialogDescription>
              <UI.Button
                onClick={() => {
                  setDialogOpen(false);
                  clearTimeout(timer.current);
                  timer.current = setTimeout(() => setDialogOpen(true), 60);
                }}
              >
                閉じてすぐ開く
              </UI.Button>
            </UI.DialogContent>
          </UI.Dialog>
          <UI.FormField label="連続開閉Select">
            <UI.Select
              open={selectOpen}
              onOpenChange={setSelectOpen}
              onValueChange={() => {
                clearTimeout(timer.current);
                timer.current = setTimeout(() => setSelectOpen(true), 60);
              }}
            >
              <UI.SelectTrigger>
                <UI.SelectValue placeholder="候補を選択" />
              </UI.SelectTrigger>
              <UI.SelectContent>
                <UI.SelectItem value="one">候補1</UI.SelectItem>
                <UI.SelectItem value="two">候補2</UI.SelectItem>
              </UI.SelectContent>
            </UI.Select>
          </UI.FormField>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setSubmitted(String(new FormData(event.currentTarget).get("chapter")));
            }}
          >
            <UI.Stack>
              <UI.FormField label="必須チャプター" required>
                <UI.Select name="chapter">
                  <UI.SelectTrigger>
                    <UI.SelectValue placeholder="チャプターを選択" />
                  </UI.SelectTrigger>
                  <UI.SelectContent>
                    <UI.SelectItem value="tokyo">Tokyo</UI.SelectItem>
                    <UI.SelectItem value="kyoto">Kyoto</UI.SelectItem>
                  </UI.SelectContent>
                </UI.Select>
              </UI.FormField>
              <UI.Button type="submit">送信</UI.Button>
              <output aria-label="送信値">{submitted}</output>
            </UI.Stack>
          </form>
          <UI.FormField label="参加場所">
            <UI.RadioGroup defaultValue="a">
              <UI.Inline>
                <UI.RadioGroupItem id="location-a" value="a" />
                <label htmlFor="location-a">会場A</label>
                <UI.RadioGroupItem id="location-b" value="b" />
                <label htmlFor="location-b">会場B</label>
              </UI.Inline>
            </UI.RadioGroup>
          </UI.FormField>
          <UI.Button onClick={() => UI.toast("トークンで描画する通知")}>通知を表示</UI.Button>
          <UI.Toaster />
        </UI.Stack>
      </UI.Card>
    </main>
  );
}
const meta = { title: "Components/Contracts", component: ContractExamples } satisfies Meta<
  typeof ContractExamples
>;
export default meta;
export const Examples: StoryObj<typeof meta> = {};
