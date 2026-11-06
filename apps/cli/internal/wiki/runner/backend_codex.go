package runner

import (
	"context"
	"encoding/json"
	"strings"
	"time"
)

// CodexBackend runs `codex exec` on the shared VM's personal ChatGPT Pro login
// (~/.codex/auth.json); never an API key. `--ignore-user-config` keeps the login but drops
// config.toml (other MCP servers, hooks, a default model), so a run sees only what we pass. workspace-write keeps writes inside dir and the
// network off, and `exec` never asks for approval.
type CodexBackend struct{ Model string }

func (b *CodexBackend) Name() string { return "codex" }

func (b *CodexBackend) Args(dir, prompt string) []string {
	args := []string{"exec", "--sandbox", "workspace-write", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--color", "never", "-C", dir}
	if b.Model != "" {
		args = append(args, "-m", b.Model)
	}
	return append(args, prompt)
}

func (b *CodexBackend) Run(ctx context.Context, dir, prompt string, timeout time.Duration) (string, error) {
	return runAgent(ctx, dir, timeout, "codex", b.Args(dir, prompt)...)
}

// Answer runs a read-only session with the wiki MCP server and a JSON-schema final message.
func (b *CodexBackend) Answer(ctx context.Context, dir, prompt, schemaPath, outPath string, mcp *MCPConfig, timeout time.Duration) (string, error) {
	return runAgent(ctx, dir, timeout, "codex", b.AnswerArgs(dir, prompt, schemaPath, outPath, mcp)...)
}

func (b *CodexBackend) AnswerArgs(dir, prompt, schemaPath, outPath string, mcp *MCPConfig) []string {
	args := []string{"exec", "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--color", "never", "-C", dir,
		"--output-schema", schemaPath, "-o", outPath}
	if b.Model != "" {
		args = append(args, "-m", b.Model)
	}
	if mcp != nil {
		quoted := make([]string, 0, len(mcp.Args))
		for _, arg := range mcp.Args {
			quoted = append(quoted, tomlString(arg))
		}
		env := make([]string, 0, len(mcp.Env))
		for key, value := range mcp.Env {
			env = append(env, key+"="+tomlString(value))
		}
		args = append(args,
			"-c", "mcp_servers.wiki.command="+tomlString(mcp.Command),
			"-c", "mcp_servers.wiki.args=["+strings.Join(quoted, ",")+"]",
			"-c", "mcp_servers.wiki.env={"+strings.Join(env, ",")+"}",
			// `exec` never prompts, so unapproved MCP calls are refused; these two tools only
			// read the wiki as the asker, so they are pre-approved.
			"-c", `mcp_servers.wiki.default_tools_approval_mode="approve"`,
		)
	}
	return append(args, prompt)
}

func tomlString(value string) string {
	encoded, _ := json.Marshal(value) // a JSON string is a valid TOML basic string
	return string(encoded)
}
