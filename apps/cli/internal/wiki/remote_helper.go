package wiki

import (
	"archive/tar"
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

// RemoteHelper implements the small, line-oriented Git remote-helper protocol
// used by a gdg-wiki::<url> remote. Wiki remains the source of truth; generated
// commits are a local cache that Git can use as merge bases and merge targets.
type RemoteHelper struct {
	Client   *Client
	Token    string
	Remote   string
	GitDir   string
	Stdin    io.Reader
	Stdout   io.Writer
	Stderr   io.Writer
	Snapshot func(context.Context, string) (Snapshot, error)
	Sync     func(context.Context, string, SyncRequest) (SyncResult, error)
	Upload   func(context.Context, string, string, []byte, string) error
}

// RunRemoteHelper serves a single Git helper invocation. name and url are the
// two arguments Git gives git-remote-gdg-wiki; url is intentionally not used
// for storage because all server access goes through the existing Wiki API.
func RunRemoteHelper(ctx context.Context, name, url string, client *Client, token string, stdin io.Reader, stdout, stderr io.Writer) error {
	_ = url
	h := &RemoteHelper{Client: client, Token: token, Remote: name, Stdin: stdin, Stdout: stdout, Stderr: stderr}
	return h.Run(ctx)
}

func (h *RemoteHelper) Run(ctx context.Context) error {
	if h.Client == nil && h.Snapshot == nil {
		return errors.New("Wiki remote helper has no snapshot client")
	}
	if h.Stdin == nil {
		h.Stdin = os.Stdin
	}
	if h.Stdout == nil {
		h.Stdout = os.Stdout
	}
	if h.Stderr == nil {
		h.Stderr = os.Stderr
	}
	if h.Remote == "" {
		h.Remote = "gdg-wiki"
	}
	if h.GitDir == "" {
		gitDir, err := h.gitOutput(ctx, "rev-parse", "--git-dir")
		if err != nil {
			return fmt.Errorf("locate Git directory: %w", err)
		}
		h.GitDir = strings.TrimSpace(gitDir)
		if !filepath.IsAbs(h.GitDir) {
			wd, wdErr := os.Getwd()
			if wdErr != nil {
				return wdErr
			}
			h.GitDir = filepath.Join(wd, h.GitDir)
		}
	}

	scanner := bufio.NewScanner(h.Stdin)
	// Git's protocol lines are intentionally small, but permit a complete ref
	// request without silently truncating it.
	scanner.Buffer(make([]byte, 1024), 1<<20)
	pendingFetch := false
	var pendingPush []pushSpec
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case line == "capabilities":
			if err := h.write("fetch\npush\n\n"); err != nil {
				return err
			}
		case line == "list" || line == "list for-push":
			commit, err := h.snapshotCommit(ctx)
			if err != nil {
				return err
			}
			if err = h.write(fmt.Sprintf("%s refs/heads/main\n\n", commit)); err != nil {
				return err
			}
		case strings.HasPrefix(line, "fetch "):
			// The commit was imported while answering list. Git only needs an
			// end-of-batch marker before it updates its own refs. Git may batch
			// multiple fetches, so wait for the terminating blank command.
			pendingFetch = true
		case strings.HasPrefix(line, "push "):
			spec, err := parsePushSpec(strings.TrimPrefix(line, "push "))
			if err != nil {
				return err
			}
			pendingPush = append(pendingPush, spec)
		case strings.HasPrefix(line, "option "):
			if err := h.write("ok\n"); err != nil {
				return err
			}
		case line == "":
			if pendingFetch {
				if err := h.write("\n"); err != nil {
					return err
				}
				pendingFetch = false
			}
			if len(pendingPush) > 0 {
				for _, spec := range pendingPush {
					if err := h.push(ctx, spec); err != nil {
						if writeErr := h.write(fmt.Sprintf("error %s %s\n", spec.dst, sanitizeProtocolError(err))); writeErr != nil {
							return writeErr
						}
						continue
					}
					if err := h.write("ok " + spec.dst + "\n"); err != nil {
						return err
					}
				}
				if err := h.write("\n"); err != nil {
					return err
				}
				pendingPush = nil
			}
		default:
			return fmt.Errorf("unsupported Git remote-helper command %q", line)
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	if pendingFetch {
		return h.write("\n")
	}
	return nil
}

type pushSpec struct{ src, dst string }

func parsePushSpec(value string) (pushSpec, error) {
	parts := strings.Split(value, ":")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return pushSpec{}, fmt.Errorf("invalid push request %q", value)
	}
	return pushSpec{src: parts[0], dst: parts[1]}, nil
}

func isGitDeleteSrc(src string) bool {
	if src == "" {
		return true
	}
	for _, r := range src {
		if r != '0' {
			return false
		}
	}
	return true
}

func sanitizeProtocolError(err error) string {
	return strings.ReplaceAll(strings.ReplaceAll(err.Error(), "\n", " "), "\r", " ")
}

type snapshotMetadata struct {
	Digest   string   `json:"digest"`
	Snapshot Snapshot `json:"snapshot"`
}

func (h *RemoteHelper) snapshotCommit(ctx context.Context) (string, error) {
	snapshot, err := h.snapshot(ctx)
	if err != nil {
		return "", err
	}
	digest, err := snapshotDigest(snapshot)
	if err != nil {
		return "", err
	}
	parent, _ := h.gitOutput(ctx, "rev-parse", "--verify", "refs/remotes/"+h.Remote+"/main")
	parent = strings.TrimSpace(parent)
	if parent != "" {
		if metadata, readErr := h.readMetadata(parent); readErr == nil && metadata.Digest == digest {
			return parent, nil
		}
	}

	return h.importSnapshot(ctx, snapshot, parent)
}

func (h *RemoteHelper) importSnapshot(ctx context.Context, snapshot Snapshot, parent string) (string, error) {
	digest, err := snapshotDigest(snapshot)
	if err != nil {
		return "", err
	}
	temporary, base, err := MaterializeSnapshot(ctx, snapshot, h.Token, h.Client, "", h.cloneLang())
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(temporary)
	// This fetch only imports the synthetic snapshot into the caller's object
	// database. It must not add a merge candidate to the outer fetch/pull's
	// FETCH_HEAD, otherwise Git sees both this temporary commit and main.
	if _, err = h.gitOutput(ctx, "fetch", "--no-write-fetch-head", "--no-tags", "--quiet", temporary, base); err != nil {
		return "", fmt.Errorf("import Wiki snapshot Git object: %w", err)
	}
	commit := base
	if parent != "" {
		tree, treeErr := h.gitOutput(ctx, "rev-parse", base+"^{tree}")
		if treeErr != nil {
			return "", treeErr
		}
		commit, err = h.gitOutput(ctx, "-c", "user.name=GDG Wiki", "-c", "user.email=wiki@gdgs.jp", "commit-tree", strings.TrimSpace(tree), "-p", parent, "-m", "Wiki snapshot")
		if err != nil {
			return "", fmt.Errorf("create synthetic Wiki snapshot commit: %w", err)
		}
		commit = strings.TrimSpace(commit)
	}
	if err = h.writeMetadata(commit, snapshotMetadata{Digest: digest, Snapshot: snapshot}); err != nil {
		return "", err
	}
	return commit, nil
}

// push translates the committed Git tree into the API's page-level optimistic
// concurrency operations. It never checks out or changes the caller's tree.
func (h *RemoteHelper) push(ctx context.Context, spec pushSpec) error {
	if spec.dst != "refs/heads/main" || isGitDeleteSrc(spec.src) {
		return errors.New("gdg-wiki accepts only updates to refs/heads/main")
	}
	base, err := h.gitOutput(ctx, "rev-parse", "--verify", "refs/remotes/"+h.Remote+"/main")
	if err != nil {
		return errors.New("no Wiki merge base; run git pull before git push")
	}
	base = strings.TrimSpace(base)
	metadata, err := h.readMetadata(base)
	if err != nil {
		return fmt.Errorf("missing Wiki metadata for merge base; run git pull before git push: %w", err)
	}
	changed, err := h.gitOutput(ctx, "diff", "--name-only", "-z", base, spec.src)
	if err != nil {
		return err
	}
	paths := strings.Split(strings.TrimSuffix(changed, "\x00"), "\x00")
	if len(paths) == 1 && paths[0] == "" {
		paths = nil
	}
	for _, path := range paths {
		if path != "AGENTS.md" && !strings.HasPrefix(path, "pages/") {
			return fmt.Errorf("only pages/** and AGENTS.md may be pushed (changed %s)", path)
		}
	}
	root, err := h.extractCommit(ctx, spec.src)
	if err != nil {
		return err
	}
	defer os.RemoveAll(root)
	var agentsUpdate *AgentInstructionsUpdate
	if pathChanged(paths, "AGENTS.md") {
		content, readErr := os.ReadFile(filepath.Join(root, "AGENTS.md"))
		if readErr != nil {
			return errors.New("AGENTS.md cannot be deleted; restore it before pushing")
		}
		if metadata.Snapshot.AgentsMD.ContentHash == "" {
			return errors.New("Wiki merge base lacks AGENTS.md metadata; run git pull before git push")
		}
		agentsUpdate = &AgentInstructionsUpdate{
			Content:             string(content),
			ExpectedContentHash: metadata.Snapshot.AgentsMD.ContentHash,
		}
	}
	local, err := LocalPagesForLanguage(root, h.cloneLang())
	if err != nil {
		return err
	}
	basePages := map[string]Page{}
	for _, page := range metadata.Snapshot.Pages {
		basePages[page.ID] = page
	}
	pending := map[string]LocalPage{}
	for key, page := range local {
		if pageChanged(paths, page.Rel) {
			pending[key] = page
		}
	}
	// Allocate IDs before building operations so new parent/child trees can be
	// submitted in one server transaction. A Git push is one logical update;
	// splitting it into page-sized requests allows an earlier page to remain
	// committed when a later request fails.
	for key, entry := range pending {
		if !strings.HasPrefix(key, "new:") {
			continue
		}
		id := newPageID(spec.src, entry.Rel)
		entry.fm.ID = id
		delete(pending, key)
		delete(local, key)
		pending[id] = entry
		local[id] = entry
	}
	keys := make([]string, 0, len(pending))
	for key := range pending {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		left, right := pending[keys[i]].Rel, pending[keys[j]].Rel
		leftDepth := strings.Count(left, string(filepath.Separator))
		rightDepth := strings.Count(right, string(filepath.Separator))
		if leftDepth != rightDepth {
			return leftDepth < rightDepth
		}
		return filepath.ToSlash(left) < filepath.ToSlash(right)
	})
	request := SyncRequest{Operations: make([]SyncOperation, 0, len(keys)+len(basePages)), AgentsMD: agentsUpdate}
	entries := make([]LocalPage, 0, len(keys))
	for _, key := range keys {
		entry := pending[key]
		page, pageErr := PageFromLocal(entry, local)
		if pageErr != nil {
			return pageErr
		}
		operation := SyncOperation{Kind: "upsert", Page: &page}
		if previous, exists := basePages[page.ID]; exists {
			operation.ExpectedRevision = previous.Revision
			preserveExistingSharing(&page, previous)
		}
		request.Operations = append(request.Operations, operation)
		entries = append(entries, entry)
	}
	for id, page := range basePages {
		if _, exists := local[id]; !exists && page.PageType != nil && *page.PageType == "task-list" {
			continue
		}
		if _, exists := local[id]; !exists {
			request.Operations = append(request.Operations, SyncOperation{Kind: "archive", ID: id, ExpectedRevision: page.Revision})
		}
	}
	if len(request.Operations) > 0 || request.AgentsMD != nil {
		result, syncErr := h.sync(ctx, request)
		if syncErr != nil {
			return syncErr
		}
		if len(result.Pages) != len(request.Operations) {
			return fmt.Errorf("Wiki sync returned %d page results for %d operations", len(result.Pages), len(request.Operations))
		}
		for i, entry := range entries {
			returned := result.Pages[i]
			for _, attachment := range entry.fm.Attachments {
				newID := returned.AttachmentIDs[attachment.FileName]
				if newID == "" {
					return fmt.Errorf("Wiki sync returned no attachment ID for %s", attachment.FileName)
				}
				if attachment.ID == "" || attachmentChanged(paths, entry.Rel, attachment.Path) {
					raw, readErr := os.ReadFile(filepath.Join(entry.Dir, attachment.Path))
					if readErr != nil {
						return readErr
					}
					if uploadErr := h.upload(ctx, newID, raw, attachment.MimeType); uploadErr != nil {
						return uploadErr
					}
				}
			}
		}
	}
	canonical, err := h.snapshot(ctx)
	if err != nil {
		return err
	}
	commit, err := h.importSnapshot(ctx, canonical, spec.src)
	if err != nil {
		return err
	}
	_, err = h.gitOutput(ctx, "update-ref", "refs/remotes/"+h.Remote+"/main", commit)
	return err
}

func newPageID(commit, rel string) string {
	digest := sha256.Sum256([]byte("gdg-wiki-page-v1\x00" + commit + "\x00" + filepath.ToSlash(rel)))
	return hex.EncodeToString(digest[:16])
}

// preserveExistingSharing keeps Wiki-app sharing when local front matter looks
// like the AGENTS.md create defaults. Agents often rewrite visibility to
// restricted while updating body content; non-default visibility changes stay.
func preserveExistingSharing(page *Page, previous Page) {
	if page == nil || !looksLikeCreateDefaultSharing(*page) {
		return
	}
	if looksLikeCreateDefaultSharing(previous) {
		return
	}
	page.Visibility = previous.Visibility
	page.GeneralRole = previous.GeneralRole
	page.ChapterID = previous.ChapterID
	page.Access = previous.Access
}

func looksLikeCreateDefaultSharing(page Page) bool {
	visibility := page.Visibility
	if visibility == "" {
		visibility = "restricted"
	}
	role := page.GeneralRole
	if role == "" {
		role = "viewer"
	}
	return visibility == "restricted" && role == "viewer" && page.ChapterID == nil && isEmptyAccess(page.Access)
}

func isEmptyAccess(access any) bool {
	if access == nil {
		return true
	}
	switch value := access.(type) {
	case []any:
		return len(value) == 0
	case []map[string]any:
		return len(value) == 0
	default:
		raw, err := json.Marshal(access)
		if err != nil {
			return false
		}
		trimmed := strings.TrimSpace(string(raw))
		return trimmed == "" || trimmed == "null" || trimmed == "[]"
	}
}

func pageChanged(paths []string, rel string) bool {
	prefix := "pages/" + filepath.ToSlash(rel) + "/"
	for _, path := range paths {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}
	return false
}

func pathChanged(paths []string, want string) bool {
	for _, path := range paths {
		if path == want {
			return true
		}
	}
	return false
}
func attachmentChanged(paths []string, rel, path string) bool {
	want := "pages/" + filepath.ToSlash(filepath.Join(rel, path))
	for _, changed := range paths {
		if changed == want {
			return true
		}
	}
	return false
}
func (h *RemoteHelper) cloneLang() string {
	root, err := WorkTreeRoot(h.GitDir)
	if err != nil {
		return "ja"
	}
	cfg, err := ReadConfig(root)
	if err != nil {
		return "ja"
	}
	return cfg.Lang
}

func (h *RemoteHelper) snapshot(ctx context.Context) (Snapshot, error) {
	if h.Snapshot != nil {
		return h.Snapshot(ctx, h.Token)
	}
	return h.Client.Snapshot(ctx, h.Token, h.cloneLang())
}
func (h *RemoteHelper) sync(ctx context.Context, request SyncRequest) (SyncResult, error) {
	if h.Sync != nil {
		return h.Sync(ctx, h.Token, request)
	}
	return h.Client.Sync(ctx, h.Token, request)
}
func (h *RemoteHelper) upload(ctx context.Context, id string, data []byte, mime string) error {
	if h.Upload != nil {
		return h.Upload(ctx, h.Token, id, data, mime)
	}
	return h.Client.Upload(ctx, h.Token, id, data, mime)
}
func (h *RemoteHelper) extractCommit(ctx context.Context, commit string) (string, error) {
	command := exec.CommandContext(ctx, "git", "archive", "--format=tar", commit)
	raw, err := command.Output()
	if err != nil {
		return "", fmt.Errorf("read commit %s: %w", commit, err)
	}
	root, err := os.MkdirTemp("", "gdg-wiki-push-")
	if err != nil {
		return "", err
	}
	reader := tar.NewReader(bytes.NewReader(raw))
	for {
		header, readErr := reader.Next()
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			os.RemoveAll(root)
			return "", readErr
		}
		path := filepath.Join(root, header.Name)
		if !strings.HasPrefix(filepath.Clean(path), root+string(filepath.Separator)) {
			os.RemoveAll(root)
			return "", errors.New("unsafe path in Git tree")
		}
		if header.FileInfo().IsDir() {
			if err = os.MkdirAll(path, 0755); err != nil {
				os.RemoveAll(root)
				return "", err
			}
			continue
		}
		if err = os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			os.RemoveAll(root)
			return "", err
		}
		file, createErr := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, header.FileInfo().Mode())
		if createErr != nil {
			os.RemoveAll(root)
			return "", createErr
		}
		_, copyErr := io.Copy(file, reader)
		closeErr := file.Close()
		if copyErr != nil || closeErr != nil {
			os.RemoveAll(root)
			if copyErr != nil {
				return "", copyErr
			}
			return "", closeErr
		}
	}
	return root, nil
}

func snapshotDigest(snapshot Snapshot) (string, error) {
	raw, err := json.Marshal(snapshot)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}

func (h *RemoteHelper) metadataPath(commit string) string {
	return filepath.Join(h.GitDir, "gdg-wiki", "snapshots", commit+".json")
}

func (h *RemoteHelper) readMetadata(commit string) (snapshotMetadata, error) {
	raw, err := os.ReadFile(h.metadataPath(commit))
	if err != nil {
		return snapshotMetadata{}, err
	}
	var metadata snapshotMetadata
	if err = json.Unmarshal(raw, &metadata); err != nil {
		return snapshotMetadata{}, fmt.Errorf("read Wiki snapshot metadata for %s: %w", commit, err)
	}
	return metadata, nil
}

func (h *RemoteHelper) writeMetadata(commit string, metadata snapshotMetadata) error {
	path := h.metadataPath(commit)
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	raw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(raw, '\n'), 0600)
}

func (h *RemoteHelper) gitOutput(ctx context.Context, args ...string) (string, error) {
	command := exec.CommandContext(ctx, "git", args...)
	output, err := command.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("git %s: %s", strings.Join(args, " "), strings.TrimSpace(string(output)))
	}
	return string(output), nil
}

func (h *RemoteHelper) write(value string) error {
	_, err := io.WriteString(h.Stdout, value)
	return err
}

func withoutEnvironment(environment []string, name string) []string {
	prefix := name + "="
	filtered := make([]string, 0, len(environment))
	for _, entry := range environment {
		if !strings.HasPrefix(entry, prefix) {
			filtered = append(filtered, entry)
		}
	}
	return filtered
}
