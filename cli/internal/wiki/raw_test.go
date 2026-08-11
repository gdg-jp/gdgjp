package wiki

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func writeEmptyChatSenders(w http.ResponseWriter) {
	_ = json.NewEncoder(w).Encode(ChatSenders{Senders: []ChatSender{}})
}

func TestIngestPromptRequiresFinalizationAfterPush(t *testing.T) {
	prompt := IngestPrompt("/tmp/wiki", 1)
	push := strings.Index(prompt, "commit and git push")
	finalize := strings.Index(prompt, "gdg wiki ingest --commit")
	if push < 0 || finalize < 0 || finalize < push {
		t.Fatalf("prompt does not order push before finalization:\n%s", prompt)
	}
	if !strings.Contains(prompt, "<acl src=") {
		t.Fatalf("prompt missing ACL gate recovery hint:\n%s", prompt)
	}
}

func TestRawLocalPathStaysUnderRaw(t *testing.T) {
	root := t.TempDir()
	path, err := rawLocalPath(root, "raw/source-1/assets/photo.png")
	if err != nil {
		t.Fatal(err)
	}
	if path != filepath.Join(root, "raw", "source-1", "assets", "photo.png") {
		t.Fatalf("path = %q", path)
	}

	for _, input := range []string{"pages/page.md", "raw/../pages/page.md", "raw"} {
		if _, err := rawLocalPath(root, input); err == nil {
			t.Errorf("rawLocalPath(%q) succeeded", input)
		}
	}
}

func TestPullRawReconcilesManifestUsingCloneLanguage(t *testing.T) {
	root := t.TempDir()
	if err := WriteConfig(root, Config{Lang: "en"}); err != nil {
		t.Fatal(err)
	}
	for path, content := range map[string]string{
		"raw/source/keep.md":               "keep",
		"raw/source/renamed-old.md":        "old",
		"raw/source/permission-removed.md": "private",
	} {
		fullPath := filepath.Join(root, filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(fullPath, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	external := filepath.Join(root, "outside.txt")
	if err := os.WriteFile(external, []byte("outside"), 0o644); err != nil {
		t.Fatal(err)
	}
	staleLink := filepath.Join(root, "raw", "source", "stale-link")
	if err := os.Symlink(external, staleLink); err != nil {
		t.Fatal(err)
	}

	keepContent := []byte("keep")
	newContent := []byte("new English content")
	manifest := SourcesManifest{Version: 1, Documents: []SourcesManifestEntry{
		{DocumentID: "keep", Path: "raw/source/keep.md", ContentHash: digest(keepContent)},
		{DocumentID: "new", Path: "raw/source/renamed-new.md", ContentHash: digest(newContent)},
	}}
	contentRequests := map[string]int{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/cli/wiki/chat-senders":
			writeEmptyChatSenders(w)
		case "/api/cli/wiki/sources":
			if got := r.URL.Query().Get("lang"); got != "en" {
				t.Errorf("manifest lang = %q, want en", got)
			}
			_ = json.NewEncoder(w).Encode(manifest)
		case "/api/cli/wiki/sources/keep/content":
			contentRequests["keep"]++
			_, _ = w.Write(keepContent)
		case "/api/cli/wiki/sources/new/content":
			contentRequests["new"]++
			if got := r.URL.Query().Get("lang"); got != "en" {
				t.Errorf("content lang = %q, want en", got)
			}
			_, _ = w.Write(newContent)
		case "/api/cli/wiki/agents-md":
			_, _ = io.WriteString(w, "agent instructions")
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := NewClientAt(server.URL)
	client.HTTPClient = server.Client()
	gotManifest, err := PullRaw(context.Background(), root, client, "token")
	if err != nil {
		t.Fatal(err)
	}
	if len(gotManifest.Documents) != len(manifest.Documents) {
		t.Fatalf("returned manifest has %d documents", len(gotManifest.Documents))
	}
	state, err := ReadState(root)
	if err != nil {
		t.Fatal(err)
	}
	if state.Manifest == nil || !reflect.DeepEqual(*state.Manifest, manifest) {
		t.Fatalf("saved manifest = %#v, want %#v", state.Manifest, manifest)
	}
	if contentRequests["new"] != 1 {
		t.Fatalf("new content requests = %d, want 1", contentRequests["new"])
	}
	for _, stale := range []string{
		"raw/source/renamed-old.md",
		"raw/source/permission-removed.md",
		"raw/source/stale-link",
	} {
		if _, err := os.Lstat(filepath.Join(root, filepath.FromSlash(stale))); !os.IsNotExist(err) {
			t.Errorf("stale path %s was not removed", stale)
		}
	}
	if raw, err := os.ReadFile(filepath.Join(root, "raw", "source", "renamed-new.md")); err != nil || string(raw) != string(newContent) {
		t.Fatalf("new raw content = %q, err = %v", raw, err)
	}
	if info, err := os.Stat(filepath.Join(root, "raw", "source")); err != nil || !info.IsDir() {
		t.Fatalf("raw directory was not preserved: %v", err)
	}
	if raw, err := os.ReadFile(external); err != nil || string(raw) != "outside" {
		t.Fatalf("symlink target changed: %q, err = %v", raw, err)
	}
}

func TestBuildIngestQueueRequeuesChangedLocalDocument(t *testing.T) {
	root := t.TempDir()
	manifest := SourcesManifest{Version: 1, Documents: []SourcesManifestEntry{{
		DocumentID:  "document-1",
		Kind:        "source-document",
		Title:       "Updated source",
		Path:        "raw/source/document.md",
		ContentHash: "new-hash",
	}}}
	_, pending, err := BuildIngestQueue(root, manifest, State{Ingested: map[string]string{"document-1": "old-hash"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(pending) != 1 || pending[0].DocumentID != "document-1" {
		t.Fatalf("pending = %#v, want updated document", pending)
	}
}

func TestBuildIngestQueueEmitsSourceIDWhenPresent(t *testing.T) {
	root := t.TempDir()
	sourceID := "parent-source-1"
	visibility := "organizer"
	manifest := SourcesManifest{Version: 1, Documents: []SourcesManifestEntry{
		{
			DocumentID:  "document-with-source",
			SourceID:    &sourceID,
			Visibility:  &visibility,
			Kind:        "source-document",
			Title:       "Chat message",
			Path:        "raw/source/chat.md",
			ContentHash: "hash-a",
		},
		{
			DocumentID:  "wiki-human:essay",
			Kind:        "wiki-human",
			Title:       "Human essay",
			Path:        "raw/wiki-human/essay.md",
			ContentHash: "hash-b",
		},
	}}
	queuePath, pending, err := BuildIngestQueue(root, manifest, State{})
	if err != nil {
		t.Fatal(err)
	}
	if len(pending) != 2 {
		t.Fatalf("pending = %#v, want 2 documents", pending)
	}
	raw, err := os.ReadFile(queuePath)
	if err != nil {
		t.Fatal(err)
	}
	got := string(raw)
	if !strings.Contains(got, "- document_id: `document-with-source`\n- source_id: `parent-source-1`\n- visibility: `organizer`\n") {
		t.Fatalf("queue missing source_id/visibility for document with SourceID:\n%s", got)
	}
	humanIdx := strings.Index(got, "## 2. Human essay")
	if humanIdx < 0 {
		t.Fatalf("queue missing wiki-human entry:\n%s", got)
	}
	if strings.Contains(got[humanIdx:], "- source_id:") {
		t.Fatalf("queue unexpectedly emitted source_id for wiki-human entry:\n%s", got[humanIdx:])
	}
	if strings.Contains(got[humanIdx:], "- visibility:") {
		t.Fatalf("queue unexpectedly emitted visibility for wiki-human entry:\n%s", got[humanIdx:])
	}
}

func TestPullRawMigratesIDDirectoriesToTitlesAndRewritesAssetPaths(t *testing.T) {
	root := t.TempDir()
	if err := WriteConfig(root, Config{Lang: "ja"}); err != nil {
		t.Fatal(err)
	}
	const sourceID = "_H_TcypgysQJlp-rTB-eC"
	legacy := filepath.Join(root, "raw", sourceID, "当日オペレーション")
	if err := os.MkdirAll(filepath.Dir(legacy), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacy, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	document := []byte("![logo](raw/_H_TcypgysQJlp-rTB-eC/assets/logo.png)\n")
	asset := []byte("png")
	manifest := SourcesManifest{Version: 1, Documents: []SourcesManifestEntry{
		{
			DocumentID:  "doc-1",
			SourceID:    stringPointer(sourceID),
			Kind:        "source-document",
			Path:        "raw/[Build with AI Kwansai 2026]/当日オペレーション",
			ContentHash: digest(document),
		},
		{
			DocumentID:  "asset-1",
			SourceID:    stringPointer(sourceID),
			Kind:        "source-asset",
			Path:        "raw/[Build with AI Kwansai 2026]/assets/logo.png",
			ContentHash: digest(asset),
		},
	}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/cli/wiki/chat-senders":
			writeEmptyChatSenders(w)
		case "/api/cli/wiki/sources":
			_ = json.NewEncoder(w).Encode(manifest)
		case "/api/cli/wiki/sources/doc-1/content":
			_, _ = w.Write(document)
		case "/api/cli/wiki/sources/asset-1/content":
			_, _ = w.Write(asset)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client := NewClientAt(server.URL)
	client.HTTPClient = server.Client()

	if _, err := PullRaw(context.Background(), root, client, "token"); err != nil {
		t.Fatal(err)
	}
	titleRoot := filepath.Join(root, "raw", "[Build with AI Kwansai 2026]")
	got, err := os.ReadFile(filepath.Join(titleRoot, "当日オペレーション"))
	if err != nil {
		t.Fatal(err)
	}
	if want := "![logo](raw/[Build with AI Kwansai 2026]/assets/logo.png)\n"; string(got) != want {
		t.Fatalf("document = %q, want %q", got, want)
	}
	if got, err := os.ReadFile(filepath.Join(titleRoot, "assets", "logo.png")); err != nil || string(got) != string(asset) {
		t.Fatalf("asset = %q, err = %v", got, err)
	}
	if _, err := os.Stat(filepath.Join(root, "raw", sourceID)); !os.IsNotExist(err) {
		t.Fatalf("legacy ID directory still exists: %v", err)
	}
}

func TestPullRawMigratesLegacyWikiHumanDirectoryToPageTree(t *testing.T) {
	root := t.TempDir()
	if err := WriteConfig(root, Config{Lang: "ja"}); err != nil {
		t.Fatal(err)
	}
	legacyPath := filepath.Join(root, "raw", "wiki-human", "operations.md")
	if err := os.MkdirAll(filepath.Dir(legacyPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacyPath, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	content := []byte("updated")
	manifest := SourcesManifest{Version: 1, Documents: []SourcesManifestEntry{{
		DocumentID:  "wiki-human:operations",
		Kind:        "wiki-human",
		Path:        "raw/guides/operations/page.md",
		ContentHash: digest(content),
	}}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/cli/wiki/chat-senders":
			writeEmptyChatSenders(w)
		case "/api/cli/wiki/sources":
			_ = json.NewEncoder(w).Encode(manifest)
		case "/api/cli/wiki/sources/wiki-human:operations/content":
			_, _ = w.Write(content)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := NewClientAt(server.URL)
	client.HTTPClient = server.Client()
	if _, err := PullRaw(context.Background(), root, client, "token"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(legacyPath); !os.IsNotExist(err) {
		t.Fatalf("legacy human page still exists: %v", err)
	}
	newPath := filepath.Join(root, "raw", "guides", "operations", "page.md")
	if got, err := os.ReadFile(newPath); err != nil || string(got) != string(content) {
		t.Fatalf("structured human page = %q, err = %v", got, err)
	}
}

func TestPullRawPreservesLocallyEditedAgentsMD(t *testing.T) {
	root := t.TempDir()
	if err := WriteConfig(root, Config{Lang: "ja"}); err != nil {
		t.Fatal(err)
	}
	local := []byte("locally maintained instructions")
	if err := os.WriteFile(filepath.Join(root, "AGENTS.md"), local, 0o644); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/cli/wiki/chat-senders":
			writeEmptyChatSenders(w)
		case "/api/cli/wiki/sources":
			_ = json.NewEncoder(w).Encode(SourcesManifest{Version: 1})
		case "/api/cli/wiki/agents-md":
			_, _ = io.WriteString(w, "older server instructions")
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client := NewClientAt(server.URL)
	client.HTTPClient = server.Client()

	if _, err := PullRaw(context.Background(), root, client, "token"); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(root, "AGENTS.md"))
	if err != nil || string(got) != string(local) {
		t.Fatalf("AGENTS.md = %q, err = %v", got, err)
	}
}

func TestPullRawDoesNotModifyGitTrackedAgentsMD(t *testing.T) {
	root := t.TempDir()
	if err := WriteConfig(root, Config{Lang: "ja"}); err != nil {
		t.Fatal(err)
	}
	previous := []byte("previous server instructions")
	if err := os.WriteFile(filepath.Join(root, "AGENTS.md"), previous, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := WriteState(root, State{Ingested: map[string]string{}, AgentsHash: digest(previous)}); err != nil {
		t.Fatal(err)
	}
	updated := []byte("updated server instructions")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/cli/wiki/chat-senders":
			writeEmptyChatSenders(w)
		case "/api/cli/wiki/sources":
			_ = json.NewEncoder(w).Encode(SourcesManifest{Version: 1})
		case "/api/cli/wiki/agents-md":
			_, _ = w.Write(updated)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client := NewClientAt(server.URL)
	client.HTTPClient = server.Client()

	if _, err := PullRaw(context.Background(), root, client, "token"); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(root, "AGENTS.md"))
	if err != nil || string(got) != string(previous) {
		t.Fatalf("AGENTS.md = %q, err = %v", got, err)
	}
	state, err := ReadState(root)
	if err != nil || state.AgentsHash != digest(previous) {
		t.Fatalf("agents hash = %q, err = %v", state.AgentsHash, err)
	}
}

func TestPullRawValidatesAllManifestPathsBeforeMutation(t *testing.T) {
	root := t.TempDir()
	if err := WriteConfig(root, Config{Lang: "ja"}); err != nil {
		t.Fatal(err)
	}
	stalePath := filepath.Join(root, "raw", "source", "stale.md")
	if err := os.MkdirAll(filepath.Dir(stalePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(stalePath, []byte("stale"), 0o644); err != nil {
		t.Fatal(err)
	}

	manifest := SourcesManifest{Version: 1, Documents: []SourcesManifestEntry{
		{DocumentID: "valid", Path: "raw/source/new.md", ContentHash: digest([]byte("new"))},
		{DocumentID: "invalid", Path: "raw/../pages/page.md", ContentHash: digest([]byte("bad"))},
	}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/cli/wiki/chat-senders":
			writeEmptyChatSenders(w)
		case "/api/cli/wiki/sources":
			_ = json.NewEncoder(w).Encode(manifest)
		default:
			t.Errorf("unexpected request after invalid manifest: %s", r.URL.Path)
			http.Error(w, "unexpected", http.StatusInternalServerError)
		}
	}))
	defer server.Close()
	client := NewClientAt(server.URL)
	client.HTTPClient = server.Client()

	_, err := PullRaw(context.Background(), root, client, "token")
	if err == nil || !strings.Contains(err.Error(), "must stay under raw") {
		t.Fatalf("PullRaw error = %v", err)
	}
	if raw, readErr := os.ReadFile(stalePath); readErr != nil || string(raw) != "stale" {
		t.Fatalf("stale file changed before validation: %q, err = %v", raw, readErr)
	}
	if _, statErr := os.Stat(filepath.Join(root, "raw", "source", "new.md")); !os.IsNotExist(statErr) {
		t.Fatalf("valid entry was written before full validation: %v", statErr)
	}
}

func TestPullRawRejectsContentThatDoesNotMatchManifestHash(t *testing.T) {
	root := t.TempDir()
	if err := WriteConfig(root, Config{Lang: "en"}); err != nil {
		t.Fatal(err)
	}
	manifest := SourcesManifest{Version: 1, Documents: []SourcesManifestEntry{
		{DocumentID: "changed", Path: "raw/source/changed.md", ContentHash: digest([]byte("manifest bytes"))},
	}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/cli/wiki/chat-senders":
			writeEmptyChatSenders(w)
		case "/api/cli/wiki/sources":
			_ = json.NewEncoder(w).Encode(manifest)
		case "/api/cli/wiki/sources/changed/content":
			_, _ = io.WriteString(w, "newer bytes")
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client := NewClientAt(server.URL)
	client.HTTPClient = server.Client()

	_, err := PullRaw(context.Background(), root, client, "token")
	if err == nil || !strings.Contains(err.Error(), "content hash mismatch") {
		t.Fatalf("PullRaw error = %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(root, "raw", "source", "changed.md")); !os.IsNotExist(statErr) {
		t.Fatalf("mismatched content was written: %v", statErr)
	}
}

func TestPullRawResolvesChatSenderNamesAndSkipsUnchanged(t *testing.T) {
	root := t.TempDir()
	if err := WriteConfig(root, Config{Lang: "ja"}); err != nil {
		t.Fatal(err)
	}

	rawMarkdown := []byte("" +
		"### [2026-07-14 21:03] Unknown user (users/alice)\n" +
		"hello\n" +
		"### [2026-07-14 21:04] Unknown user (users/unknown)\n" +
		"body mentions Unknown user (users/alice) and should stay\n")
	replacedMarkdown := []byte("" +
		"### [2026-07-14 21:03] Alice Example\n" +
		"hello\n" +
		"### [2026-07-14 21:04] Unknown user (users/unknown)\n" +
		"body mentions Unknown user (users/alice) and should stay\n")
	senders := ChatSenders{Senders: []ChatSender{
		{ResourceName: "users/alice", DisplayName: "Alice Example"},
	}}
	sendersHash, err := digestSendersMap(senders.Map())
	if err != nil {
		t.Fatal(err)
	}
	manifest := SourcesManifest{Version: 1, Documents: []SourcesManifestEntry{
		{
			DocumentID:  "week-1",
			Kind:        "source-document",
			Path:        "raw/chat/week.md",
			ContentHash: digest(rawMarkdown),
		},
	}}

	var contentRequests int
	currentSenders := senders
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/cli/wiki/chat-senders":
			_ = json.NewEncoder(w).Encode(currentSenders)
		case "/api/cli/wiki/sources":
			_ = json.NewEncoder(w).Encode(manifest)
		case "/api/cli/wiki/sources/week-1/content":
			contentRequests++
			_, _ = w.Write(rawMarkdown)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client := NewClientAt(server.URL)
	client.HTTPClient = server.Client()

	if _, err := PullRaw(context.Background(), root, client, "token"); err != nil {
		t.Fatal(err)
	}
	if contentRequests != 1 {
		t.Fatalf("first pull content requests = %d, want 1", contentRequests)
	}
	path := filepath.Join(root, "raw", "chat", "week.md")
	got, err := os.ReadFile(path)
	if err != nil || string(got) != string(replacedMarkdown) {
		t.Fatalf("rendered content =\n%q\nwant\n%q\nerr=%v", got, replacedMarkdown, err)
	}
	state, err := ReadState(root)
	if err != nil {
		t.Fatal(err)
	}
	if state.SendersHash != sendersHash {
		t.Fatalf("sendersHash = %q, want %q", state.SendersHash, sendersHash)
	}
	if state.Rendered["week-1"] != digest(replacedMarkdown) {
		t.Fatalf("rendered digest = %q, want %q", state.Rendered["week-1"], digest(replacedMarkdown))
	}

	if _, err := PullRaw(context.Background(), root, client, "token"); err != nil {
		t.Fatal(err)
	}
	if contentRequests != 1 {
		t.Fatalf("second pull re-downloaded: content requests = %d, want 1", contentRequests)
	}

	renamed := ChatSenders{Senders: []ChatSender{
		{ResourceName: "users/alice", DisplayName: "Alice Renamed"},
	}}
	renamedMarkdown := []byte("" +
		"### [2026-07-14 21:03] Alice Renamed\n" +
		"hello\n" +
		"### [2026-07-14 21:04] Unknown user (users/unknown)\n" +
		"body mentions Unknown user (users/alice) and should stay\n")
	currentSenders = renamed
	if _, err := PullRaw(context.Background(), root, client, "token"); err != nil {
		t.Fatal(err)
	}
	if contentRequests != 2 {
		t.Fatalf("rename pull content requests = %d, want 2", contentRequests)
	}
	got, err = os.ReadFile(path)
	if err != nil || string(got) != string(renamedMarkdown) {
		t.Fatalf("renamed content =\n%q\nwant\n%q\nerr=%v", got, renamedMarkdown, err)
	}
	state, err = ReadState(root)
	if err != nil {
		t.Fatal(err)
	}
	wantHash, err := digestSendersMap(renamed.Map())
	if err != nil {
		t.Fatal(err)
	}
	if state.SendersHash != wantHash {
		t.Fatalf("sendersHash after rename = %q, want %q", state.SendersHash, wantHash)
	}
	if state.Rendered["week-1"] != digest(renamedMarkdown) {
		t.Fatalf("rendered digest after rename = %q", state.Rendered["week-1"])
	}
}

func TestPullRawRejectsTamperedContentBeforeSenderReplace(t *testing.T) {
	root := t.TempDir()
	if err := WriteConfig(root, Config{Lang: "ja"}); err != nil {
		t.Fatal(err)
	}
	manifestBytes := []byte("### [12:00] Unknown user (users/alice)\n")
	manifest := SourcesManifest{Version: 1, Documents: []SourcesManifestEntry{
		{
			DocumentID:  "week-1",
			Kind:        "source-document",
			Path:        "raw/chat/week.md",
			ContentHash: digest(manifestBytes),
		},
	}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/cli/wiki/chat-senders":
			_ = json.NewEncoder(w).Encode(ChatSenders{Senders: []ChatSender{
				{ResourceName: "users/alice", DisplayName: "Alice"},
			}})
		case "/api/cli/wiki/sources":
			_ = json.NewEncoder(w).Encode(manifest)
		case "/api/cli/wiki/sources/week-1/content":
			// Tampered payload: would look fine after replace if verification ran second.
			_, _ = io.WriteString(w, "### [12:00] Unknown user (users/alice)\ntampered\n")
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client := NewClientAt(server.URL)
	client.HTTPClient = server.Client()

	_, err := PullRaw(context.Background(), root, client, "token")
	if err == nil || !strings.Contains(err.Error(), "content hash mismatch") {
		t.Fatalf("PullRaw error = %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(root, "raw", "chat", "week.md")); !os.IsNotExist(statErr) {
		t.Fatalf("tampered content was written: %v", statErr)
	}
}

func TestPullRawSucceedsFromLegacyStateWithoutRendered(t *testing.T) {
	root := t.TempDir()
	if err := WriteConfig(root, Config{Lang: "ja"}); err != nil {
		t.Fatal(err)
	}
	// Legacy clones only persist Ingested / AgentsHash.
	if err := WriteState(root, State{Ingested: map[string]string{"other": "abc"}, AgentsHash: "old"}); err != nil {
		t.Fatal(err)
	}
	content := []byte("### [12:00] Unknown user (users/alice)\n")
	manifest := SourcesManifest{Version: 1, Documents: []SourcesManifestEntry{
		{
			DocumentID:  "week-1",
			Kind:        "source-document",
			Path:        "raw/chat/week.md",
			ContentHash: digest(content),
		},
	}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/cli/wiki/chat-senders":
			_ = json.NewEncoder(w).Encode(ChatSenders{Senders: []ChatSender{
				{ResourceName: "users/alice", DisplayName: "Alice"},
			}})
		case "/api/cli/wiki/sources":
			_ = json.NewEncoder(w).Encode(manifest)
		case "/api/cli/wiki/sources/week-1/content":
			_, _ = w.Write(content)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client := NewClientAt(server.URL)
	client.HTTPClient = server.Client()

	if _, err := PullRaw(context.Background(), root, client, "token"); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(root, "raw", "chat", "week.md"))
	if err != nil || string(got) != "### [12:00] Alice\n" {
		t.Fatalf("content = %q, err = %v", got, err)
	}
	state, err := ReadState(root)
	if err != nil {
		t.Fatal(err)
	}
	if state.Ingested["other"] != "abc" {
		t.Fatalf("legacy Ingested was lost: %#v", state.Ingested)
	}
	if state.AgentsHash != "old" {
		t.Fatalf("legacy AgentsHash was lost: %q", state.AgentsHash)
	}
	if state.Rendered["week-1"] == "" || state.SendersHash == "" {
		t.Fatalf("rendered state not recorded: %#v", state)
	}
}

func TestApplyChatSenderNamesOnlyReplacesHeadings(t *testing.T) {
	input := []byte("" +
		"### [10:00] Unknown user (users/a)\n" +
		"see Unknown user (users/a) in body\n" +
		"### [11:00] Unknown user (users/missing)\n")
	got := applyChatSenderNames(input, map[string]string{"users/a": "A"})
	want := "" +
		"### [10:00] A\n" +
		"see Unknown user (users/a) in body\n" +
		"### [11:00] Unknown user (users/missing)\n"
	if string(got) != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}
