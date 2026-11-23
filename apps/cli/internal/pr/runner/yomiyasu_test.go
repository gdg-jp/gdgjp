package runner

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

func TestSkipKeysMatchPlaybookJapaneseTexts(t *testing.T) {
	path := filepath.Join("..", "..", "..", "..", "..", "skills", "pr-playbook", "scripts", "checks", "util.mjs")
	source, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		t.Skipf("%s is absent; run git submodule update --init skills", path)
	}
	if err != nil {
		t.Fatal(err)
	}
	block := regexp.MustCompile(`(?s)const SKIP_KEYS = new Set\(\[(.*?)\]\);`).FindSubmatch(source)
	if block == nil {
		t.Fatalf("SKIP_KEYS not found in %s", path)
	}
	var want []string
	for _, match := range regexp.MustCompile(`"([^"]+)"`).FindAllSubmatch(block[1], -1) {
		want = append(want, string(match[1]))
	}
	sort.Strings(want)
	got := make([]string, 0, len(skipKeys))
	for key, skip := range skipKeys {
		if skip {
			got = append(got, key)
		}
	}
	sort.Strings(got)
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("skipKeys = %v, want SKIP_KEYS from %s = %v", got, path, want)
	}
}
