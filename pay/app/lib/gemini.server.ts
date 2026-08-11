export type ReceiptExtraction = {
  spentOn: string | null;
  amountYen: number | null;
  category: string | null;
  description: string | null;
};

function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Gemini response did not contain JSON");
  return JSON.parse(candidate.slice(start, end + 1));
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNullableAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string") {
    const digits = value.replace(/[^\d]/g, "");
    if (!digits) return null;
    const amount = Number(digits);
    return Number.isSafeInteger(amount) ? amount : null;
  }
  return null;
}

export async function extractReceiptFields(
  env: Pick<Env, "GEMINI_API_KEY" | "GEMINI_MODEL_ID">,
  input: { bytes: ArrayBuffer; mimeType: string; filename: string },
): Promise<ReceiptExtraction> {
  const model = env.GEMINI_MODEL_ID || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
  const bytes = new Uint8Array(input.bytes);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const base64 = btoa(binary);
  const prompt = `あなたは日本の経費精算アシスタントです。領収書/請求書から次の JSON だけを返してください。
{
  "spentOn": "YYYY-MM-DD or null",
  "amountYen": 整数円 or null,
  "category": "印刷物|広告|ケータリング|ノベルティ|会場費|交通費|その他 のいずれか or null",
  "description": "品目の短い日本語説明 or null"
}
ファイル名: ${input.filename}
税込の支払総額を amountYen にしてください。推測できない項目は null。`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: input.mimeType,
                data: base64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini error ${res.status}: ${body}`);
  }
  const payload = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text =
    payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  const parsed = extractJsonObject(text) as Record<string, unknown>;
  return {
    spentOn: asNullableString(parsed.spentOn),
    amountYen: asNullableAmount(parsed.amountYen),
    category: asNullableString(parsed.category),
    description: asNullableString(parsed.description),
  };
}
