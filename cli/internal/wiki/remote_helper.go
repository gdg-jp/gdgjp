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

func sanitizeProtocolError(err error) string {
	return strings.ReplaceAll(strings.ReplaceAll(err.Error(), "\n", " "), "\r", " ")
}

type snapshotMetadata struct {
	Digest   string   `json:"digest"`
	Snapshot Snapshot `json:"snapshot"`
}

func (h *RemoteHelper) snapshotCommit(ctx context.Context) (string, error) {
	snapshotFn := h.Snapshot
	if snapshotFn == nil {
		snapshotFn = h.Client.Snapshot
	}
	snapshot, err := snapshotFn(ctx, h.Token)
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
	temporary, base, err := MaterializeSnapshot(ctx, snapshot, h.Token, h.Client, "")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(temporary)
	if _, err = h.gitOutput(ctx, "fetch", "--no-tags", "--quiet", temporary, base); err != nil {
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
	if spec.dst != "refs/heads/main" || strings.HasPrefix(spec.src, "0") {
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
		if !strings.HasPrefix(path, "pages/") {
			return fmt.Errorf("only pages/** may be pushed (changed %s)", path)
		}
	}
	root, err := h.extractCommit(ctx, spec.src)
	if err != nil {
		return err
	}
	defer os.RemoveAll(root)
	local, err := LocalPages(root)
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
	for len(pending) > 0 {
		keys := make([]string, 0, len(pending))
		for key := range pending {
			keys = append(keys, key)
		}
		sort.Slice(keys, func(i, j int) bool {
			return strings.Count(pending[keys[i]].Rel, string(filepath.Separator)) < strings.Count(pending[keys[j]].Rel, string(filepath.Separator))
		})
		progress := false
		for _, key := range keys {
			entry := pending[key]
			page, pageErr := PageFromLocal(entry, local)
			if pageErr != nil {
				if strings.Contains(pageErr.Error(), "new parent has not been created") {
					continue
				}
				return pageErr
			}
			operation := SyncOperation{Kind: "upsert", Page: &page}
			if previous, exists := basePages[page.ID]; exists {
				operation.ExpectedRevision = previous.Revision
			}
			result, syncErr := h.sync(ctx, SyncRequest{Operations: []SyncOperation{operation}})
			if syncErr != nil {
				return syncErr
			}
			if len(result.Pages) != 1 {
				return errors.New("Wiki sync returned no page result")
			}
			returned := result.Pages[0]
			for i := range entry.ja.Attachments {
				attachment := &entry.ja.Attachments[i]
				newID := returned.AttachmentIDs[attachment.FileName]
				if newID == "" {
					return fmt.Errorf("Wiki sync returned no attachment ID for %s", attachment.FileName)
				}
				needsUpload := attachment.ID == "" || attachmentChanged(paths, entry.Rel, attachment.Path)
				attachment.ID = newID
				if needsUpload {
					raw, readErr := os.ReadFile(filepath.Join(entry.Dir, attachment.Path))
					if readErr != nil {
						return readErr
					}
					if uploadErr := h.upload(ctx, newID, raw, attachment.MimeType); uploadErr != nil {
						return uploadErr
					}
				}
			}
			entry.ja.ID, entry.en.ID = returned.ID, returned.ID
			local[returned.ID] = entry
			if key != returned.ID {
				delete(local, key)
			}
			delete(pending, key)
			progress = true
		}
		if !progress {
			return errors.New("new pages have an unresolved parent")
		}
	}
	for id, page := range basePages {
		if _, exists := local[id]; !exists && page.PageType != nil && *page.PageType == "task-list" {
			continue
		}
		if _, exists := local[id]; !exists {
			if err := h.syncOnly(ctx, SyncRequest{Operations: []SyncOperation{{Kind: "archive", ID: id, ExpectedRevision: page.Revision}}}); err != nil {
				return err
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

func pageChanged(paths []string, rel string) bool {
	prefix := "pages/" + filepath.ToSlash(rel) + "/"
	for _, path := range paths {
		if strings.HasPrefix(path, prefix) {
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
func (h *RemoteHelper) snapshot(ctx context.Context) (Snapshot, error) {
	if h.Snapshot != nil {
		return h.Snapshot(ctx, h.Token)
	}
	return h.Client.Snapshot(ctx, h.Token)
}
func (h *RemoteHelper) sync(ctx context.Context, request SyncRequest) (SyncResult, error) {
	if h.Sync != nil {
		return h.Sync(ctx, h.Token, request)
	}
	return h.Client.Sync(ctx, h.Token, request)
}
func (h *RemoteHelper) syncOnly(ctx context.Context, request SyncRequest) error {
	_, err := h.sync(ctx, request)
	return err
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
