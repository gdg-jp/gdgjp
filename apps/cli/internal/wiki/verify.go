package wiki

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
)

// ValidateACLAccess is the subset of AccessEntry needed for dry-run ACL checks.
type ValidateACLAccess struct {
	SubjectType string `json:"subjectType"`
	SubjectKey  string `json:"subjectKey"`
}

type ValidateACLSource struct {
	SourceID string `json:"sourceId,omitempty"`
}

type ValidateACLPage struct {
	ID         *string             `json:"id"`
	Slug       string              `json:"slug"`
	Title      string              `json:"title"`
	Summary    string              `json:"summary"`
	Content    string              `json:"content"`
	Tags       []string            `json:"tags"`
	Visibility string              `json:"visibility"`
	Access     []ValidateACLAccess `json:"access"`
	Sources    []ValidateACLSource `json:"sources"`
}

type ValidateACLRequest struct {
	Lang          string            `json:"lang"`
	Pages         []ValidateACLPage `json:"pages"`
	ReadSourceIDs []string          `json:"readSourceIds"`
}

type ValidateACLFinding struct {
	Slug     string `json:"slug"`
	Error    string `json:"error"`
	SourceID string `json:"sourceId,omitempty"`
}

type ValidateACLResult struct {
	OK       bool                 `json:"ok"`
	Findings []ValidateACLFinding `json:"findings,omitempty"`
}

// GitRunner matches the command-layer gitRunner for verify helpers.
type GitRunner func(ctx context.Context, directory string, args ...string) (string, error)

// pageRelFromPath maps a pages/** file path (optionally porcelain-prefixed) to
// the page directory rel used by LocalPages (e.g. "venues/umeda").
func pageRelFromPath(name string) string {
	name = filepath.ToSlash(strings.TrimSpace(name))
	if name == "" {
		return ""
	}
	// status --porcelain: "XY path" or "XY orig -> path"
	if len(name) > 3 && (name[2] == ' ' || name[2] == '\t') {
		name = strings.TrimSpace(name[3:])
		if i := strings.Index(name, " -> "); i >= 0 {
			name = name[i+4:]
		}
	}
	name = strings.Trim(name, `"`)
	if !strings.HasPrefix(name, "pages/") {
		return ""
	}
	rest := strings.TrimPrefix(name, "pages/")
	parts := strings.Split(rest, "/")
	if len(parts) == 0 {
		return ""
	}
	dirParts := parts
	last := parts[len(parts)-1]
	if last == "page.md" || last == "ja.md" || last == "en.md" {
		dirParts = parts[:len(parts)-1]
	} else if len(parts) >= 2 && parts[len(parts)-2] == "assets" {
		dirParts = parts[:len(parts)-2]
	}
	if len(dirParts) == 0 {
		return ""
	}
	return strings.Join(dirParts, "/")
}

func uniquePageRels(paths []string) []string {
	seen := map[string]struct{}{}
	var rels []string
	for _, name := range paths {
		rel := pageRelFromPath(name)
		if rel == "" {
			continue
		}
		if _, ok := seen[rel]; ok {
			continue
		}
		seen[rel] = struct{}{}
		rels = append(rels, rel)
	}
	return rels
}

// CollectChangedPageRels returns pages/ relative directory paths changed vs
// origin/main or dirty in the worktree.
func CollectChangedPageRels(ctx context.Context, root string, runGit GitRunner) ([]string, error) {
	seen := map[string]struct{}{}
	addPath := func(name string) {
		if rel := pageRelFromPath(name); rel != "" {
			seen[rel] = struct{}{}
		}
	}

	diffOut, err := runGit(ctx, root, "diff", "--name-only", "refs/remotes/origin/main", "--", "pages/")
	if err != nil {
		diffOut = ""
	}
	for _, line := range strings.Split(diffOut, "\n") {
		addPath(line)
	}
	statusOut, err := runGit(ctx, root, "status", "--porcelain", "--untracked-files=all", "--", "pages/")
	if err != nil {
		return nil, err
	}
	for _, line := range strings.Split(statusOut, "\n") {
		addPath(line)
	}
	rels := make([]string, 0, len(seen))
	for rel := range seen {
		rels = append(rels, rel)
	}
	return rels, nil
}

func pageSourceIDs(sources any) []ValidateACLSource {
	raw, err := json.Marshal(sources)
	if err != nil || len(raw) == 0 || string(raw) == "null" {
		return []ValidateACLSource{}
	}
	var entries []map[string]any
	if err = json.Unmarshal(raw, &entries); err != nil {
		return []ValidateACLSource{}
	}
	out := make([]ValidateACLSource, 0, len(entries))
	for _, entry := range entries {
		id, _ := entry["sourceId"].(string)
		if id == "" {
			id, _ = entry["source_id"].(string)
		}
		if id != "" {
			out = append(out, ValidateACLSource{SourceID: id})
		}
	}
	return out
}

func pageAccessEntries(access any) []ValidateACLAccess {
	raw, err := json.Marshal(access)
	if err != nil || len(raw) == 0 || string(raw) == "null" {
		return []ValidateACLAccess{}
	}
	var entries []map[string]any
	if err = json.Unmarshal(raw, &entries); err != nil {
		return []ValidateACLAccess{}
	}
	out := make([]ValidateACLAccess, 0, len(entries))
	for _, entry := range entries {
		subjectType, _ := entry["subjectType"].(string)
		if subjectType == "" {
			subjectType, _ = entry["subject_type"].(string)
		}
		subjectKey, _ := entry["subjectKey"].(string)
		if subjectKey == "" {
			subjectKey, _ = entry["subject_key"].(string)
		}
		if subjectType != "" && subjectKey != "" {
			out = append(out, ValidateACLAccess{SubjectType: subjectType, SubjectKey: subjectKey})
		}
	}
	return out
}

// BuildValidateACLPages loads changed local pages into the dry-run payload shape.
func BuildValidateACLPages(root string, changedRels []string) ([]ValidateACLPage, error) {
	all, err := LocalPages(root)
	if err != nil {
		return nil, err
	}
	want := map[string]struct{}{}
	for _, rel := range changedRels {
		want[filepath.ToSlash(rel)] = struct{}{}
	}
	// A push creates new parent/child trees in one transaction (the remote helper allocates
	// the IDs first), so a new page under a new parent is valid here too. PageFromLocal only
	// resolves parents by key, so give new pages placeholder keys; each page keeps its own
	// front matter, so a new page is still sent without an ID.
	parents := make(map[string]LocalPage, len(all))
	for key, local := range all {
		if strings.HasPrefix(key, "new:") {
			key = "pending:" + filepath.ToSlash(local.Rel)
		}
		parents[key] = local
	}
	pages := make([]ValidateACLPage, 0, len(want))
	for _, local := range all {
		if _, ok := want[filepath.ToSlash(local.Rel)]; !ok {
			continue
		}
		page, err := PageFromLocal(local, parents)
		if err != nil {
			return nil, err
		}
		locale := page.JA
		if local.Language() == "en" {
			locale = page.EN
		}
		var id *string
		if page.ID != "" {
			idCopy := page.ID
			id = &idCopy
		}
		tags := page.Tags
		if tags == nil {
			tags = []string{}
		}
		visibility := page.Visibility
		if visibility == "" {
			visibility = "restricted"
		}
		pages = append(pages, ValidateACLPage{
			ID:         id,
			Slug:       page.Slug,
			Title:      locale.Title,
			Summary:    locale.Summary,
			Content:    locale.Content,
			Tags:       tags,
			Visibility: visibility,
			Access:     pageAccessEntries(page.Access),
			Sources:    pageSourceIDs(page.Sources),
		})
	}
	return pages, nil
}

func addSourceID(seen map[string]struct{}, ids *[]string, id string) {
	if id == "" {
		return
	}
	if _, ok := seen[id]; ok {
		return
	}
	seen[id] = struct{}{}
	*ids = append(*ids, id)
}

// FormatACLFindings renders findings for agents and --commit output.
func FormatACLFindings(findings []ValidateACLFinding) string {
	if len(findings) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("ACL validation failed:\n")
	for _, finding := range findings {
		switch {
		case finding.SourceID != "" && finding.Slug != "":
			fmt.Fprintf(&b, "- %s: %s (sourceId=%s)\n", finding.Slug, finding.Error, finding.SourceID)
		case finding.SourceID != "":
			fmt.Fprintf(&b, "- %s (sourceId=%s)\n", finding.Error, finding.SourceID)
		case finding.Slug != "":
			fmt.Fprintf(&b, "- %s: %s\n", finding.Slug, finding.Error)
		default:
			fmt.Fprintf(&b, "- %s\n", finding.Error)
		}
	}
	return strings.TrimRight(b.String(), "\n")
}

// VerifyACL builds the dry-run request and calls the server.
func VerifyACL(ctx context.Context, root string, client *Client, token string, runGit GitRunner, readSources []string) (ValidateACLResult, error) {
	return VerifyACLWithReadSources(ctx, root, client, token, runGit, readSources)
}

// VerifyACLWithReadSources dry-runs the ACL checks for the clone's changed pages. The read
// set is explicit: the runner passes its job's sources (`verify-acl --read-sources`); a nil
// set is an error, so a caller can never fall back to "checked nothing".
func VerifyACLWithReadSources(ctx context.Context, root string, client *Client, token string, runGit GitRunner, readSources []string) (ValidateACLResult, error) {
	if readSources == nil {
		return ValidateACLResult{}, fmt.Errorf("read sources are required (pass --read-sources)")
	}
	config, err := ReadConfig(root)
	if err != nil {
		return ValidateACLResult{}, err
	}
	if config.Space != "" {
		client.Space = config.Space
	}
	state, err := LoadState(root)
	if err != nil {
		return ValidateACLResult{}, err
	}
	if state.Manifest == nil {
		return ValidateACLResult{}, fmt.Errorf("no local raw snapshot")
	}
	rels, err := CollectChangedPageRels(ctx, root, runGit)
	if err != nil {
		return ValidateACLResult{}, err
	}
	if len(rels) == 0 {
		return ValidateACLResult{OK: true}, nil
	}
	pages, err := BuildValidateACLPages(root, rels)
	if err != nil {
		return ValidateACLResult{}, err
	}
	return client.ValidateACL(ctx, token, ValidateACLRequest{Lang: config.Lang, Pages: pages, ReadSourceIDs: readSources})
}
