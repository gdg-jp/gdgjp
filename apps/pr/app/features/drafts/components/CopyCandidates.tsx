import { Table } from "@gdgjp/design-system";

type Candidate = {
  mainCopy?: string;
  connpassTitle?: string;
  xShort?: string;
  igShort?: string;
  flyerLine?: string;
  metaThemeMapping?: { theme: string; projection: string }[];
};

export function CopyCandidates({ candidates }: { candidates: Candidate[] }) {
  return (
    <Table>
      <thead>
        <tr>
          <th>#</th>
          <th>メインコピー</th>
          <th>connpass タイトル</th>
          <th>X / Instagram / フライヤー</th>
          <th>メタテーマとの対応</th>
        </tr>
      </thead>
      <tbody>
        {candidates.map((c, i) => (
          <tr key={`${i}-${c.mainCopy}`}>
            <td>{i + 1}</td>
            <td className="font-semibold">{c.mainCopy}</td>
            <td>{c.connpassTitle}</td>
            <td className="text-sm">
              <div>X: {c.xShort}</div>
              <div>IG: {c.igShort}</div>
              <div>フライヤー: {c.flyerLine}</div>
            </td>
            <td className="text-sm">
              {c.metaThemeMapping?.map((m) => (
                <div key={m.theme}>
                  {m.theme} → {m.projection}
                </div>
              ))}
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
