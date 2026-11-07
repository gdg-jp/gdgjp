package runner

import (
	"context"
	"encoding/json"
	"sort"
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

// AnswerWithImages is Answer with images attached to the prompt (`--image`). The prompt goes
// after `--` because `--image` takes several values.
func (b *CodexBackend) AnswerWithImages(ctx context.Context, dir, prompt, schemaPath, outPath string, images []string, timeout time.Duration) (string, error) {
	return runAgent(ctx, dir, timeout, "codex", b.ImageAnswerArgs(dir, prompt, schemaPath, outPath, images)...)
}

func (b *CodexBackend) ImageAnswerArgs(dir, prompt, schemaPath, outPath string, images []string) []string {
	return b.OptionsArgs(dir, prompt, schemaPath, outPath, AnswerOptions{Images: images})
}

// AnswerOptions: what a structured run may add to the read-only default. WorkspaceWrite lets the
// agent write inside dir (design drafts); the network stays off. Env is set for the agent's shell
// commands (the agent's shell otherwise inherits only the core variables, never tokens).
type AnswerOptions struct {
	Images         []string
	WorkspaceWrite bool
	Env            map[string]string
}

// AnswerWithOptions runs a structured session with the options.
func (b *CodexBackend) AnswerWithOptions(ctx context.Context, dir, prompt, schemaPath, outPath string, opts AnswerOptions, timeout time.Duration) (string, error) {
	return runAgent(ctx, dir, timeout, "codex", b.OptionsArgs(dir, prompt, schemaPath, outPath, opts)...)
}

func (b *CodexBackend) OptionsArgs(dir, prompt, schemaPath, outPath string, opts AnswerOptions) []string {
	args := b.AnswerArgs(dir, prompt, schemaPath, outPath, nil)
	args = args[:len(args)-1] // the prompt goes last
	if opts.WorkspaceWrite {
		for i := range args {
			if args[i] == "--sandbox" && i+1 < len(args) {
				args[i+1] = "workspace-write"
			}
		}
		args = append(args, "-c", `shell_environment_policy.inherit="core"`)
	}
	keys := make([]string, 0, len(opts.Env))
	for key := range opts.Env {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		args = append(args, "-c", "shell_environment_policy.set."+key+"="+tomlString(opts.Env[key]))
	}
	if len(opts.Images) == 0 {
		return append(args, prompt)
	}
	return append(args, "--image", strings.Join(opts.Images, ","), "--", prompt)
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
