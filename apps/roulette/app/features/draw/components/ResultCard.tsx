import { Badge, Card, Heading, Separator, Stack, Text } from "@gdgjp/design-system";
import { rankLabel, textUnits } from "~/features/prizes/odds";
import type { DrawResult } from "../result";

/** What staff check before handing the prize over: the prize, draw number and time. */
export function ResultCard({ result }: { result: DrawResult }) {
  const lose = result.tier === "lose";
  return (
    // <output> is a live status region, so screen readers announce the result.
    <output className="block">
      <Card className="text-center">
        <Stack align="center" className="gap-2">
          {!lose && (
            <Badge tone={result.tier === "jackpot" ? "warning" : "info"}>
              {rankLabel(result.rank)}
            </Badge>
          )}
          <Heading level={2} className={textUnits(result.name) <= 9 ? "text-2xl" : "text-xl"}>
            {result.name}
          </Heading>
          <Text tone="muted">
            {lose
              ? "ご参加ありがとうございました。またの機会に！"
              : "おめでとうございます！ この画面をスタッフに見せて、景品を受け取ってください。"}
          </Text>
          {!lose && (
            <>
              <Separator />
              <div className="flex justify-center gap-8">
                <div>
                  <Text size="xs" tone="muted">
                    抽選番号
                  </Text>
                  <p className="text-xl font-semibold tabular-nums">
                    No. {String(result.number).padStart(3, "0")}
                  </p>
                </div>
                <div>
                  <Text size="xs" tone="muted">
                    日時
                  </Text>
                  <p className="text-xl font-semibold tabular-nums">{result.time}</p>
                </div>
              </div>
            </>
          )}
        </Stack>
      </Card>
    </output>
  );
}
