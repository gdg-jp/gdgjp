package wiki

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
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
	if err != nil {
		return err
	}
	return removeEmptyRawDirectories(rawRoot)
}

func removeEmptyRawDirectories(rawRoot string) error {
	var directories []string
	err := filepath.WalkDir(rawRoot, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() && path != rawRoot {
			directories = append(directories, path)
		}
		return nil
	})
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	for i := len(directories) - 1; i >= 0; i-- {
		if err := os.Remove(directories[i]); err != nil && !os.IsNotExist(err) && !errors.Is(err, fs.ErrExist) {
			return err
		}
	}
	return nil
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
// Files whose rendered digest still matches are skipped. Ingested hashes are
// kept only when the server content hash is unchanged. The returned
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
			data = rewriteRawSourcePaths(data, doc)
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
	state.Ingested = reconcileIngested(state, manifest)
	state.SendersHash = sendersHash
	state.Manifest = &manifest
	if err = WriteState(root, state); err != nil {
		return SourcesManifest{}, err
	}
	if err = WriteACLSources(root, manifest); err != nil {
		return SourcesManifest{}, fmt.Errorf("write ACL source metadata: %w", err)
	}
	return manifest, nil
}

func rewriteRawSourcePaths(data []byte, doc SourcesManifestEntry) []byte {
	if doc.Kind != "source-document" || doc.SourceID == nil || *doc.SourceID == "" {
		return data
	}
	const rawPrefix = "raw/"
	if !strings.HasPrefix(doc.Path, rawPrefix) {
		return data
	}
	remainder := strings.TrimPrefix(doc.Path, rawPrefix)
	sourceDirectory, _, found := strings.Cut(remainder, "/")
	if !found || sourceDirectory == "" {
		return data
	}
	return bytes.ReplaceAll(
		data,
		[]byte(rawPrefix+*doc.SourceID+"/"),
		[]byte(rawPrefix+sourceDirectory+"/"),
	)
}

func shouldSkipRawPull(state State, sendersHash string, doc SourcesManifestEntry, localPath string) bool {
	if prev, ok := previousManifestHash(state, doc.DocumentID); ok && prev != doc.ContentHash {
		return false
	}
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

func previousManifestHash(state State, documentID string) (string, bool) {
	if state.Manifest == nil {
		return "", false
	}
	for _, doc := range state.Manifest.Documents {
		if doc.DocumentID == documentID {
			return doc.ContentHash, true
		}
	}
	return "", false
}

// reconcileIngested updates local ingest completion after a raw pull.
// Unchanged content hashes stay ingested. Hash changes stay recorded as the
// prior hash so the next ingest queue marks them "changed". New documents are
// omitted. If a document id rotates but source + relative path and hash stay
// the same, the ingested record moves to the new id. Orphan ids are kept so a
// later reappearance with the same hash is not treated as new.
func reconcileIngested(state State, manifest SourcesManifest) map[string]string {
	alive := make(map[string]struct{})
	hashByIdentity := map[string]string{}
	identityID := map[string]string{}
	if state.Manifest != nil {
		for _, doc := range state.Manifest.Documents {
			if doc.Kind == "source-asset" {
				continue
			}
			if hash, ok := state.Ingested[doc.DocumentID]; ok {
				ident := ingestIdentity(doc)
				hashByIdentity[ident] = hash
				identityID[ident] = doc.DocumentID
			}
		}
	}
	for _, doc := range manifest.Documents {
		if doc.Kind != "source-asset" {
			alive[doc.DocumentID] = struct{}{}
		}
	}

	next := make(map[string]string, len(state.Ingested))
	for id, hash := range state.Ingested {
		if _, ok := alive[id]; !ok {
			next[id] = hash
		}
	}
	for _, doc := range manifest.Documents {
		if doc.Kind == "source-asset" {
			continue
		}
		if hash, ok := state.Ingested[doc.DocumentID]; ok {
			next[doc.DocumentID] = hash
			continue
		}
		ident := ingestIdentity(doc)
		hash, ok := hashByIdentity[ident]
		if !ok || hash != doc.ContentHash {
			continue
		}
		next[doc.DocumentID] = hash
		if oldID := identityID[ident]; oldID != "" && oldID != doc.DocumentID {
			delete(next, oldID)
		}
	}
	return next
}

func ingestIdentity(doc SourcesManifestEntry) string {
	if doc.Kind == "wiki-human" {
		return "wiki-human\x00" + doc.DocumentID
	}
	sourceID := ""
	if doc.SourceID != nil {
		sourceID = *doc.SourceID
	}
	if sourceID != "" {
		return sourceID + "\x00" + sourceRelativePath(doc.Path)
	}
	return doc.Kind + "\x00" + doc.DocumentID
}

func sourceRelativePath(manifestPath string) string {
	remainder := strings.TrimPrefix(filepath.ToSlash(manifestPath), "raw/")
	_, rest, found := strings.Cut(remainder, "/")
	if !found {
		return remainder
	}
	return rest
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

// PendingIngestDocuments returns queue candidates without writing INGEST_QUEUE.md.
// Only source-document and wiki-human entries are queued.
func PendingIngestDocuments(manifest SourcesManifest, state CloneState) []SourcesManifestEntry {
	var pending []SourcesManifestEntry
	for _, doc := range manifest.Documents {
		if doc.Kind == "source-asset" {
			continue
		}
		known := state.Ingested[doc.DocumentID]
		if known == doc.ContentHash {
			continue
		}
		pending = append(pending, doc)
	}
	return pending
}

// BuildIngestQueue compares manifest hashes with local ingested state
// and writes INGEST_QUEUE.md. Only source-document and wiki-human entries are queued.
func BuildIngestQueue(root string, manifest SourcesManifest, state CloneState) (queuePath string, pending []SourcesManifestEntry, err error) {
	pending = PendingIngestDocuments(manifest, state)
	var b strings.Builder
	b.WriteString("# Ingest queue\n\n")
	b.WriteString("Process **only the first item**. Generated by `gdg wiki ingest`.\n\n")
	if len(pending) == 0 {
		b.WriteString("_No pending documents._\n")
	} else {
		for i, doc := range pending {
			change := "new"
			prior := state.Ingested[doc.DocumentID]
			if prior != "" {
				change = "changed"
			}
			fmt.Fprintf(&b, "## %d. %s\n\n", i+1, doc.Title)
			fmt.Fprintf(&b, "- path: `%s`\n", doc.Path)
			fmt.Fprintf(&b, "- document_id: `%s`\n", doc.DocumentID)
			if doc.SourceID != nil && *doc.SourceID != "" {
				fmt.Fprintf(&b, "- source_id: `%s`\n", *doc.SourceID)
			}
			if doc.Visibility != nil && *doc.Visibility != "" {
				fmt.Fprintf(&b, "- visibility: `%s`\n", *doc.Visibility)
			}
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
Read AGENTS.md (especially Confidentiality and Span ACLs) and skill wiki-ingest.
Run gdg wiki ingest lock (no args) to claim one pending document_id, then process
ONLY that source from INGEST_QUEUE.md.
Update pages/**, index, and log as instructed, commit and git push, then run
gdg wiki ingest --commit --document-id <id> to mark the source complete, unlock
it, and refresh the queue.
If you abort without --commit, run gdg wiki ingest unlock <id> (add --force if needed).
Do not edit raw/**. Do not remove raw/ from .gitignore.
If visibility is not member, wrap derived material in <acl src="<source_id>">…</acl>
before commit. Do not reset page visibility to restricted while updating content.
ACL gate findings (acl_required, acl_untagged_read_source) mean tagging is
incomplete — fix tags and retry. They do not mean you lack permission when you
can already read the raw source.
`, root))
}

func LintPrompt(root string) string {
	return strings.TrimSpace(fmt.Sprintf(`
You are linting the GDG Japan Wiki clone at %s.
Read AGENTS.md, especially the Lint section, and perform that checklist.
Record results in log. Fix pages when you can.
`, root))
}
