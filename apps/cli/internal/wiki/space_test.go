package wiki

import "testing"

func TestClientWithSpaceScopesCLIPathsOnly(t *testing.T) {
	c := &Client{Space: "tokyo"}
	cases := map[string]string{
		"/api/cli/wiki/snapshot?lang=ja": "/api/cli/wiki/snapshot?lang=ja&space=tokyo",
		"/api/cli/wiki/agents-md":        "/api/cli/wiki/agents-md?space=tokyo",
		"/api/runner/heartbeat":          "/api/runner/heartbeat",
	}
	for in, want := range cases {
		if got := c.withSpace(in); got != want {
			t.Fatalf("withSpace(%q) = %q, want %q", in, got, want)
		}
	}
	if got := (&Client{}).withSpace("/api/cli/wiki/agents-md"); got != "/api/cli/wiki/agents-md" {
		t.Fatalf("no space must leave the path alone: %q", got)
	}
}

func TestRawWantedFilter(t *testing.T) {
	a, b := "a", "b"
	docA := SourcesManifestEntry{SourceID: &a}
	docB := SourcesManifestEntry{SourceID: &b}
	legacy := SourcesManifestEntry{}
	if !rawWanted(Config{}, docA) || !rawWanted(Config{}, legacy) {
		t.Fatal("no filter downloads everything")
	}
	if rawWanted(Config{NoRaw: true}, docA) {
		t.Fatal("NoRaw downloads nothing")
	}
	only := Config{RawSources: []string{"a"}}
	if !rawWanted(only, docA) || rawWanted(only, docB) || rawWanted(only, legacy) {
		t.Fatal("RawSources downloads only the listed sources")
	}
}

func TestConfigRejectsBadSpace(t *testing.T) {
	root := t.TempDir()
	if err := WriteConfig(root, Config{Lang: "ja", Space: "../x"}); err == nil {
		t.Fatal("expected an invalid space error")
	}
	if err := WriteConfig(root, Config{Lang: "ja", Space: "gdg-tokyo", NoRaw: true}); err != nil {
		t.Fatal(err)
	}
	cfg, err := ReadConfig(root)
	if err != nil || cfg.Space != "gdg-tokyo" || !cfg.NoRaw {
		t.Fatalf("ReadConfig = %+v, %v", cfg, err)
	}
}
