# Font provenance

- Google Sans / Google Sans Italic: [Google Fonts公式リリース v14.000](https://github.com/googlefonts/googlesans/releases/tag/v14.000)。variable TTFをFontTools 4.65.0 + Brotli 1.2.0でWOFF2に変換。字形・軸・名前の編集なし。ライセンスは `fonts/GoogleSans-OFL.txt`。
- Noto Sans JP: [Google Fonts公式配布](https://github.com/google/fonts/tree/main/ofl/notosansjp)、2026-09-11取得。variable TTFを同じ手順でWOFF2に変換。ライセンスは `fonts/NotoSansJP-OFL.txt`。
- 変換物のSHA-256を以下に記録。フォントは任意の `fonts.css` importによりself-hostし、実行時に外部フォントサーバーへアクセスしません。

| ファイル | SHA-256 |
| --- | --- |
| GoogleSans-Italic.woff2 | `f14eac2fb580069fd798350a3ba52df842fc224c7fed3e7b25802384df04adc2` |
| GoogleSans-OFL.txt | `831b6e041705873c3e6efb18c4c96202bc41c8be42a456d3d26c47abf14816d0` |
| GoogleSans.woff2 | `1cffb3e594b6740f9b7957316941f714f10f4593ae4ca8c4243ce1edca380409` |
| NotoSansJP-OFL.txt | `1c05c68c34f9708415aada51f17e1b0092d2cea709bf4a94cd38114f9e73d7d9` |
| NotoSansJP.woff2 | `5960ad654512a681b3a279a6bf2d1f9a8910907a3b28fa256f02158045d2ba98` |
