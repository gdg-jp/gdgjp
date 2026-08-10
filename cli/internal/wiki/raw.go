package wiki

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// rawLocalPath resolves a manifest path under the clone root and rejects
// anything that would escape raw/.
func rawLocalPath(root, manifestPath string) (string, error) {
	clean := filepath.ToSlash(filepath.Clean("/" + strings.TrimPrefix(manifestPath, "/")))
	clean = strings.TrimPrefix(clean, "/")
	if clean != "raw" && !strings.HasPrefix(clean, "raw/") {
		return "", fmt.Errorf("manifest path must stay under raw/: %s", manifestPath)
	}
	if clean == "raw" {
		return "", fmt.Errorf("manifest path must be a file under raw/: %s", manifestPath)
	}
	local := filepath.Join(root, filepath.FromSlash(clean))
	rel, err := filepath.Rel(filepath.Join(root, "raw"), local)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("manifest path escapes raw/: %s", manifestPath)
	}
	return local, nil
}

func validateManifestPaths(root string, manifest SourcesManifest) (map[string]struct{}, error) {
	expected := make(map[string]struct{}, len(manifest.Documents))
	for _, doc := range manifest.Documents {
		localPath, err := rawLocalPath(root, doc.Path)
		if err != nil {
			return nil, err
		}
		localPath = filepath.Clean(localPath)
		if _, exists := expected[localPath]; exists {
			return nil, fmt.Errorf("duplicate manifest path: %s", doc.Path)
		}
		if err = ensureRawPathHasNoSymlinks(root, localPath); err != nil {
			return nil, err
		}
		expected[localPath] = struct{}{}
	}
	return expected, nil
}

func ensureRawPathHasNoSymlinks(root, localPath string) error {
	rawRoot := filepath.Join(root, "raw")
	if info, err := os.Lstat(rawRoot); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("raw path contains symlink: %s", rawRoot)
	} else if err != nil && !os.IsNotExist(err) {
		return err
	}
	rel, err := filepath.Rel(rawRoot, localPath)
	if err != nil {
		return err
	}
	current := rawRoot
	for _, part := range strings.Split(rel, string(filepath.Separator)) {
		current = filepath.Join(current, part)
		info, statErr := os.Lstat(current)
		if os.IsNotExist(statErr) {
			return nil
		}
		if statErr != nil {
			return statErr
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("raw path contains symlink: %s", current)
		}
	}
	return nil
}

func removeStaleRawFiles(root string, expected map[string]struct{}) error {
	rawRoot := filepath.Join(root, "raw")
	err := filepath.WalkDir(rawRoot, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		if _, keep := expected[filepath.Clean(path)]; keep {
			return nil
		}
		return os.Remove(path)
	})
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

func syncAgentsMD(root string, agents []byte) error {
	state, err := ReadState(root)
	if err != nil {
		return err
	}
	path := filepath.Join(root, "AGENTS.md")
	current, readErr := os.ReadFile(path)
	serverHash := digest(agents)
	if readErr == nil {
		currentHash := digest(current)
		switch {
		case currentHash == serverHash:
			state.AgentsHash = serverHash
			return WriteState(root, state)
		case state.AgentsHash == "" || currentHash != state.AgentsHash:
			// The clone predates AGENTS.md hash tracking or has local edits.
			// Preserve it until it matches the canonical server copy again.
			return nil
		}
	} else if !os.IsNotExist(readErr) {
		return readErr
	}
	if err = os.WriteFile(path, agents, 0o644); err != nil {
		return err
	}
	state.AgentsHash = serverHash
	return WriteState(root, state)
}

// PullRaw synchronizes raw/** from the Wiki API. AGENTS.md is Git-tracked.
// Chat Markdown sender placeholders are resolved locally after hash verification.
// Files whose rendered digest still matches are skipped. The returned
// manifest is the exact snapshot used for local reconciliation.
func PullRaw(ctx context.Context, root string, client *Client, token string) (SourcesManifest, error) {
	cfg, err := ReadConfig(root)
	if err != nil {
		return SourcesManifest{}, err
	}
	state, err := LoadState(root)
	if err != nil {
		return SourcesManifest{}, err
	}
	chatSenders, err := client.ChatSenders(ctx, token)
	if err != nil {
		return SourcesManifest{}, err
	}
	senders := chatSenders.Map()
	sendersHash, err := digestSendersMap(senders)
	if err != nil {
		return SourcesManifest{}, err
	}
	manifest, err := client.SourcesManifest(ctx, token, cfg.Lang)
	if err != nil {
		return SourcesManifest{}, err
	}
	expected, err := validateManifestPaths(root, manifest)
	if err != nil {
		return SourcesManifest{}, err
	}
	for _, doc := range manifest.Documents {
		localPath, pathErr := rawLocalPath(root, doc.Path)
		if pathErr != nil {
			return SourcesManifest{}, pathErr
		}
		if pathErr = ensureRawPathHasNoSymlinks(root, localPath); pathErr != nil {
			return SourcesManifest{}, pathErr
		}
		if shouldSkipRawPull(state, sendersHash, doc, localPath) {
			continue
		}
		data, getErr := client.SourceContent(ctx, token, doc.DocumentID, cfg.Lang)
		if getErr != nil {
			return SourcesManifest{}, fmt.Errorf("download %s: %w", doc.Path, getErr)
		}
		if contentHash := digest(data); contentHash != doc.ContentHash {
			return SourcesManifest{}, fmt.Errorf(
				"download %s: content hash mismatch (got %s, want %s)",
				doc.Path,
				contentHash,
				doc.ContentHash,
			)
		}
		if doc.Kind != "source-asset" {
			data = applyChatSenderNames(data, senders)
		}
		if writeErr := os.MkdirAll(filepath.Dir(localPath), 0o755); writeErr != nil {
			return SourcesManifest{}, writeErr
		}
		if writeErr := os.WriteFile(localPath, data, 0o644); writeErr != nil {
			return SourcesManifest{}, writeErr
		}
		state.Rendered[doc.DocumentID] = digest(data)
	}
	if err = removeStaleRawFiles(root, expected); err != nil {
		return SourcesManifest{}, err
	}
	pruneRendered(state, manifest)
	state.SendersHash = sendersHash
	if err = WriteState(root, state); err != nil {
		return SourcesManifest{}, err
	}
	return manifest, nil
}

func shouldSkipRawPull(state State, sendersHash string, doc SourcesManifestEntry, localPath string) bool {
	if state.SendersHash != sendersHash {
		return false
	}
	existing, readErr := os.ReadFile(localPath)
	if readErr != nil {
		return false
	}
	localDigest := digest(existing)
	if rendered, ok := state.Rendered[doc.DocumentID]; ok {
		return localDigest == rendered
	}
	// Pre-Rendered clones: fall back to the server content hash.
	return localDigest == doc.ContentHash
}

func digestSendersMap(senders map[string]string) (string, error) {
	if senders == nil {
		senders = map[string]string{}
	}
	raw, err := json.Marshal(senders)
	if err != nil {
		return "", err
	}
	return digest(raw), nil
}

func pruneRendered(state State, manifest SourcesManifest) {
	alive := make(map[string]struct{}, len(manifest.Documents))
	for _, doc := range manifest.Documents {
		alive[doc.DocumentID] = struct{}{}
	}
	for id := range state.Rendered {
		if _, ok := alive[id]; !ok {
			delete(state.Rendered, id)
		}
	}
}

// Matches Chat week-Markdown sender headings written as placeholders by the Worker.
var chatSenderHeadingRE = regexp.MustCompile(
	`(?m)^### \[([^\]]+)\] Unknown user \((users/[A-Za-z0-9_-]+)\)$`,
)

func applyChatSenderNames(data []byte, senders map[string]string) []byte {
	if len(senders) == 0 {
		return data
	}
	return chatSenderHeadingRE.ReplaceAllFunc(data, func(match []byte) []byte {
		sub := chatSenderHeadingRE.FindSubmatch(match)
		if len(sub) < 3 {
			return match
		}
		name, ok := senders[string(sub[2])]
		if !ok || name == "" {
			return match
		}
		return []byte("### [" + string(sub[1]) + "] " + name)
	})
}

// BuildIngestQueue compares manifest hashes with local+server ingested state
// and writes INGEST_QUEUE.md. Only source-document and wiki-human entries are queued.
func BuildIngestQueue(root string, manifest SourcesManifest, state CloneState) (queuePath string, pending []SourcesManifestEntry, err error) {
	for _, doc := range manifest.Documents {
		if doc.Kind == "source-asset" {
			continue
		}
		known := state.Ingested[doc.DocumentID]
		if known == "" && doc.IngestedHash != nil {
			known = *doc.IngestedHash
		}
		if known == doc.ContentHash {
			continue
		}
		pending = append(pending, doc)
	}
	var b strings.Builder
	b.WriteString("# Ingest queue\n\n")
	b.WriteString("Process **only the first item**. Generated by `gdg wiki ingest`.\n\n")
	if len(pending) == 0 {
		b.WriteString("_No pending documents._\n")
	} else {
		for i, doc := range pending {
			change := "new"
			prior := state.Ingested[doc.DocumentID]
			if prior == "" && doc.IngestedHash != nil {
				prior = *doc.IngestedHash
			}
			if prior != "" {
				change = "changed"
			}
			fmt.Fprintf(&b, "## %d. %s\n\n", i+1, doc.Title)
			fmt.Fprintf(&b, "- path: `%s`\n", doc.Path)
			fmt.Fprintf(&b, "- document_id: `%s`\n", doc.DocumentID)
			fmt.Fprintf(&b, "- change: %s\n", change)
			fmt.Fprintf(&b, "- content_hash: `%s`\n", doc.ContentHash)
			if prior != "" {
				fmt.Fprintf(&b, "- prior_hash: `%s`\n", prior)
			}
			b.WriteString("\n")
		}
	}
	queuePath = filepath.Join(root, "INGEST_QUEUE.md")
	err = os.WriteFile(queuePath, []byte(b.String()), 0o644)
	return queuePath, pending, err
}

func IngestPrompt(root string, pendingCount int) string {
	if pendingCount == 0 {
		return "No pending ingest items. INGEST_QUEUE.md is empty."
	}
	return strings.TrimSpace(fmt.Sprintf(`
You are maintaining the GDG Japan Wiki clone at %s.
Read AGENTS.md and process ONLY the first item in INGEST_QUEUE.md.
Update pages/**, index, and log as instructed, commit and git push, then run
gdg wiki ingest --commit to mark the source complete and refresh the queue.
Do not edit raw/**. Do not remove raw/ from .gitignore.
`, root))
}

func LintPrompt(root string) string {
	return strings.TrimSpace(fmt.Sprintf(`
You are linting the GDG Japan Wiki clone at %s.
Read AGENTS.md, especially the Lint section, and perform that checklist.
Record results in log. Fix pages when you can.
`, root))
}
