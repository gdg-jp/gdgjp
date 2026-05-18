# gen-image-cli — Claude Code Skill（CLI 版）

讓 Claude Code 透過 Codex CLI 呼叫 OpenAI **Image-2**（API 模型 `gpt-image-2`）生圖，產出檔案直接落到當前專案的 `./images/`。

> 想在 Claude 桌面 App 的 Chat / Cowork 視窗使用？請改裝同 zip 內的 `gen-image-app` Skill。

## 安裝

通常你會直接用 zip 一次裝兩個：

```bash
mkdir -p ~/.claude/skills && unzip -o ~/Downloads/gen-image-skills.zip -d ~/.claude/skills/
```

只要這個 CLI 版的話：

```bash
mkdir -p ~/.claude/skills
cp -r gen-image-cli ~/.claude/skills/
```

## 前置需求

1. 已安裝 [Codex CLI](https://github.com/openai/codex) 0.125 以上
2. 已用 ChatGPT 帳號登入：
   ```bash
   codex login
   codex login status   # 應顯示 Logged in using ChatGPT
   ```
3. 第一次執行若被 `.codex` 權限擋住：
   ```bash
   sudo chown -R $(whoami) ~/.codex
   ```

## 使用

在 Claude Code 中直接說：

- 「生圖一張賽博龐克貓」
- 「畫一張戴墨鏡的柴犬」
- 「來張未來城市的封面圖」

Claude 會自動呼叫 Codex CLI、把圖落到當前工作目錄的 `./images/` 下。

## 授權

MIT。隨意改、隨意用。
