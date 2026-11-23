package wiki

import (
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

func serverSpaceSlugRule(t *testing.T) func(string) bool {
	t.Helper()
	path := filepath.Join("..", "..", "..", "wiki", "app", "features", "spaces", "shared.ts")
	source, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	pattern := regexp.MustCompile(`(?m)^const SLUG_PATTERN = /(.+)/;$`).FindSubmatch(source)
	if pattern == nil {
		t.Fatalf("SLUG_PATTERN not found in %s", path)
	}
	minimum := regexp.MustCompile(`(?s)export function isValidSpaceSlug\(slug: string\): boolean \{\s*return slug\.length >= (\d+) && SLUG_PATTERN\.test\(slug\);\s*\}`).FindSubmatch(source)
	if minimum == nil {
		t.Fatalf("isValidSpaceSlug body changed in %s; update this test to mirror it", path)
	}
	rule, err := regexp.Compile(string(pattern[1]))
	if err != nil {
		t.Fatal(err)
	}
	minLength, err := strconv.Atoi(string(minimum[1]))
	if err != nil {
		t.Fatal(err)
	}
	return func(slug string) bool { return len(slug) >= minLength && rule.MatchString(slug) }
}

func spaceSlugCandidates() []string {
	var candidates []string
	level := []string{""}
	for length := 1; length <= 5; length++ {
		var next []string
		for _, prefix := range level {
			for _, r := range "a0-" {
				next = append(next, prefix+string(r))
			}
		}
		candidates = append(candidates, next...)
		level = next
	}
	for r := rune(0x20); r < 0x7f; r++ {
		candidates = append(candidates, "a"+string(r), string(r)+"a", "a"+string(r)+"a")
	}
	for length := 36; length <= 70; length++ {
		body := strings.Repeat("a", length-1)
		candidates = append(candidates, body+"z", body+"9", body+"-", "-"+body, strings.Repeat("a-", length/2)+"0")
	}
	return candidates
}

func TestValidSpaceSlugAcceptsEveryServerSpaceSlug(t *testing.T) {
	server := serverSpaceSlugRule(t)
	accepted := 0
	for _, slug := range spaceSlugCandidates() {
		if !server(slug) {
			continue
		}
		accepted++
		if !ValidSpaceSlug(slug) {
			t.Errorf("ValidSpaceSlug(%q) = false, but the server accepts it", slug)
		}
	}
	if accepted == 0 {
		t.Fatal("no candidate satisfies the server rule")
	}
}
