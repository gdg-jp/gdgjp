package runner

import (
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"testing"
	"time"
)

func TestAnswerTimeoutStaysInsideTheJobDeadline(t *testing.T) {
	path := filepath.Join("..", "..", "..", "..", "wiki", "app", "features", "jobs", "answer.server.ts")
	source, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	match := regexp.MustCompile(`(?m)^export const ANSWER_DEADLINE_SECONDS = (\d+);`).FindSubmatch(source)
	if match == nil {
		t.Fatalf("ANSWER_DEADLINE_SECONDS not found in %s", path)
	}
	seconds, err := strconv.Atoi(string(match[1]))
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Duration(seconds) * time.Second
	if answerTimeout >= deadline {
		t.Fatalf("answerTimeout = %s, want less than the %s job deadline", answerTimeout, deadline)
	}
}
