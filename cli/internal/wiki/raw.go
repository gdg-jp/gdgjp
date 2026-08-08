package wiki

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
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

// PullRaw synchronizes raw/** and AGENTS.md from the Wiki API.
// Files whose local sha256 matches the manifest are skipped. The returned
// manifest is the exact snapshot used for local reconciliation.
func PullRaw(ctx context.Context, root string, client *Client, token string) (SourcesManifest, error) {
	cfg, err := ReadConfig(root)
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
		if existing, readErr := os.ReadFile(localPath); readErr == nil && digest(existing) == doc.ContentHash {
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
		if writeErr := os.MkdirAll(filepath.Dir(localPath), 0o755); writeErr != nil {
			return SourcesManifest{}, writeErr
		}
		if writeErr := os.WriteFile(localPath, data, 0o644); writeErr != nil {
			return SourcesManifest{}, writeErr
		}
	}
	if err = removeStaleRawFiles(root, expected); err != nil {
		return SourcesManifest{}, err
	}
	agents, err := client.AgentsMD(ctx, token)
	if err != nil {
		return SourcesManifest{}, err
	}
	if err = os.WriteFile(filepath.Join(root, "AGENTS.md"), agents, 0o644); err != nil {
		return SourcesManifest{}, err
	}
	return manifest, nil
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
Update pages/**, index, and log as instructed, then commit and git push.
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
