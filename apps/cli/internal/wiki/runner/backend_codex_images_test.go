package runner

import (
	"strings"
	"testing"
)

func TestImageAnswerArgsPutThePromptAfterDoubleDash(t *testing.T) {
	b := &CodexBackend{}
	joined := strings.Join(b.ImageAnswerArgs("/w", "q", "/w/s.json", "/w/o.json", []string{"/w/a.png", "/w/b.png"}), " ")
	if !strings.HasSuffix(joined, "--image /w/a.png,/w/b.png -- q") || !strings.Contains(joined, "--sandbox read-only") {
		t.Fatalf("args = %s", joined)
	}
	plain := b.ImageAnswerArgs("/w", "q", "/w/s.json", "/w/o.json", nil)
	if plain[len(plain)-1] != "q" || strings.Contains(strings.Join(plain, " "), "--image") {
		t.Fatalf("args = %v", plain)
	}
}

func TestOptionsArgsWorkspaceWriteAndEnv(t *testing.T) {
	b := &CodexBackend{}
	args := b.OptionsArgs("/job", "prompt", "/job/s.json", "/job/o.json", AnswerOptions{
		Images:         []string{"/job/a.png"},
		WorkspaceWrite: true,
		Env:            map[string]string{"GDG_RENDER_BROKER": ".render"},
	})
	joined := strings.Join(args, " ")
	for _, want := range []string{
		"--sandbox workspace-write",
		`shell_environment_policy.inherit="core"`,
		`shell_environment_policy.set.GDG_RENDER_BROKER=".render"`,
		"--image /job/a.png -- prompt",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("args miss %q: %s", want, joined)
		}
	}
	if strings.Contains(joined, "read-only") {
		t.Fatalf("read-only left in: %s", joined)
	}
	plain := strings.Join(b.OptionsArgs("/job", "prompt", "/job/s.json", "/job/o.json", AnswerOptions{}), " ")
	if !strings.Contains(plain, "--sandbox read-only") || !strings.HasSuffix(plain, " prompt") {
		t.Fatalf("default stays read-only with the prompt last: %s", plain)
	}
}
