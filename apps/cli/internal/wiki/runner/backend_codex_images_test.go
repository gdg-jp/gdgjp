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
