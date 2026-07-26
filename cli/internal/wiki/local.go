package wiki

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"gopkg.in/yaml.v3"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type FrontMatter struct {
	GDGWiki           int          `yaml:"gdg_wiki"`
	ID                string       `yaml:"id,omitempty"`
	Slug              string       `yaml:"slug"`
	Language          string       `yaml:"language"`
	Title             string       `yaml:"title"`
	Summary           string       `yaml:"summary"`
	TranslationStatus string       `yaml:"translation_status"`
	Status            string       `yaml:"status,omitempty"`
	PageType          any          `yaml:"page_type,omitempty"`
	PageMetadata      any          `yaml:"page_metadata,omitempty"`
	ParentSlug        *string      `yaml:"parent_slug,omitempty"`
	SortOrder         int          `yaml:"sort_order,omitempty"`
	Visibility        string       `yaml:"visibility,omitempty"`
	GeneralRole       string       `yaml:"general_role,omitempty"`
	ChapterID         *string      `yaml:"chapter_id,omitempty"`
	Tags              []string     `yaml:"tags,omitempty"`
	Access            any          `yaml:"access,omitempty"`
	Sources           any          `yaml:"sources,omitempty"`
	Attachments       []Attachment `yaml:"attachments,omitempty"`
}
type StatePage struct {
	Revision int    `json:"revision"`
	JA       string `json:"ja"`
	EN       string `json:"en"`
	Path     string `json:"path"`
}
type State struct {
	Version int                  `json:"version"`
	Pages   map[string]StatePage `json:"pages"`
}

// ErrParentNotCreated lets the command create nested new pages in parent-first
// batches without ever guessing an ID or flattening the hierarchy.
var ErrParentNotCreated = errors.New("new parent has not been created")

func splitMarkdown(raw []byte) (FrontMatter, string, error) {
	s := string(raw)
	if !strings.HasPrefix(s, "---\n") {
		return FrontMatter{}, "", errors.New("markdown must start with YAML front matter")
	}
	rest := s[4:]
	n := strings.Index(rest, "\n---\n")
	if n < 0 {
		return FrontMatter{}, "", errors.New("front matter is not closed")
	}
	var fm FrontMatter
	if err := yaml.Unmarshal([]byte(rest[:n]), &fm); err != nil {
		return fm, "", fmt.Errorf("parse front matter: %w", err)
	}
	return fm, rest[n+5:], nil
}
func renderMarkdown(fm FrontMatter, content string) ([]byte, error) {
	raw, err := yaml.Marshal(fm)
	if err != nil {
		return nil, err
	}
	return []byte("---\n" + string(raw) + "---\n" + content), nil
}
func statePath(root string) string { return filepath.Join(root, ".gdg", "wiki-state.json") }
func LoadState(root string) (State, error) {
	raw, err := os.ReadFile(statePath(root))
	if errors.Is(err, os.ErrNotExist) {
		return State{Version: 1, Pages: map[string]StatePage{}}, nil
	}
	if err != nil {
		return State{}, err
	}
	var s State
	err = json.Unmarshal(raw, &s)
	if s.Pages == nil {
		s.Pages = map[string]StatePage{}
	}
	return s, err
}
func SaveState(root string, s State) error {
	if err := os.MkdirAll(filepath.Dir(statePath(root)), 0755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(statePath(root), append(raw, '\n'), 0600)
}
func digest(raw []byte) string { h := sha256.Sum256(raw); return hex.EncodeToString(h[:]) }
func pageDir(root string, p Page, byID map[string]Page) (string, error) {
	parts := []string{}
	seen := map[string]bool{}
	for {
		if seen[p.ID] {
			return "", fmt.Errorf("cycle at %s", p.Slug)
		}
		seen[p.ID] = true
		parts = append([]string{p.Slug}, parts...)
		if p.ParentID == nil {
			break
		}
		parent, ok := byID[*p.ParentID]
		if !ok {
			return "", fmt.Errorf("missing parent for %s", p.Slug)
		}
		p = parent
	}
	return filepath.Join(append([]string{root, "pages"}, parts...)...), nil
}
func WritePage(root string, p Page, byID map[string]Page, token string, c *Client) (StatePage, error) {
	dir, err := pageDir(root, p, byID)
	if err != nil {
		return StatePage{}, err
	}
	if err = os.MkdirAll(filepath.Join(dir, "assets"), 0755); err != nil {
		return StatePage{}, err
	}
	var parentSlug *string
	if p.ParentID != nil {
		v := byID[*p.ParentID].Slug
		parentSlug = &v
	}
	attachments := append([]Attachment(nil), p.Attachments...)
	for i := range attachments {
		attachments[i].Path = filepath.ToSlash(filepath.Join("assets", attachmentLocalName(attachments[i])))
	}
	common := FrontMatter{GDGWiki: 1, ID: p.ID, Slug: p.Slug, Language: "ja", Title: p.JA.Title, Summary: p.JA.Summary, TranslationStatus: p.JA.TranslationStatus, Status: p.Status, PageType: p.PageType, PageMetadata: p.PageMetadata, ParentSlug: parentSlug, SortOrder: p.SortOrder, Visibility: p.Visibility, GeneralRole: p.GeneralRole, ChapterID: p.ChapterID, Tags: p.Tags, Access: p.Access, Sources: p.Sources, Attachments: attachments}
	ja, err := renderMarkdown(common, p.JA.Content)
	if err != nil {
		return StatePage{}, err
	}
	en, err := renderMarkdown(FrontMatter{GDGWiki: 1, ID: p.ID, Slug: p.Slug, Language: "en", Title: p.EN.Title, Summary: p.EN.Summary, TranslationStatus: p.EN.TranslationStatus}, p.EN.Content)
	if err != nil {
		return StatePage{}, err
	}
	if err = os.WriteFile(filepath.Join(dir, "ja.md"), ja, 0644); err != nil {
		return StatePage{}, err
	}
	if err = os.WriteFile(filepath.Join(dir, "en.md"), en, 0644); err != nil {
		return StatePage{}, err
	}
	for _, a := range p.Attachments {
		if a.DownloadURL == "" {
			continue
		}
		data, err := c.Download(contextBackground(), token, a.DownloadURL)
		if err != nil {
			return StatePage{}, err
		}
		if err = os.WriteFile(filepath.Join(dir, "assets", attachmentLocalName(a)), data, 0644); err != nil {
			return StatePage{}, err
		}
	}
	return StatePage{Revision: p.Revision, JA: string(ja), EN: string(en), Path: dir}, nil
}

// Keep each attachment distinct even when several attachments share the same
// display name. The server-side attachment ID is stable across clone/sync.
func attachmentLocalName(attachment Attachment) string {
	name := filepath.Base(attachment.FileName)
	if attachment.ID == "" {
		return name
	}
	return attachment.ID + "-" + name
}

// variable makes filesystem helpers testable without threading context through every function.
var contextBackground = func() context.Context { return context.Background() }

func LocalPages(root string) (map[string]LocalPage, error) {
	result := map[string]LocalPage{}
	base := filepath.Join(root, "pages")
	err := filepath.WalkDir(base, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || d.Name() != "ja.md" {
			return nil
		}
		dir := filepath.Dir(path)
		jaRaw, e := os.ReadFile(path)
		if e != nil {
			return e
		}
		enRaw, e := os.ReadFile(filepath.Join(dir, "en.md"))
		if e != nil {
			return fmt.Errorf("%s: missing en.md", dir)
		}
		ja, jac, e := splitMarkdown(jaRaw)
		if e != nil {
			return fmt.Errorf("%s: %w", path, e)
		}
		en, enc, e := splitMarkdown(enRaw)
		if e != nil {
			return e
		}
		if ja.Language != "ja" || en.Language != "en" || ja.GDGWiki != 1 || en.GDGWiki != 1 || ja.Slug == "" || ja.Slug != en.Slug || ja.ID != en.ID {
			return fmt.Errorf("%s: invalid paired page metadata", dir)
		}
		rel, _ := filepath.Rel(base, dir)
		key := ja.ID
		if key == "" {
			key = "new:" + rel
		}
		if _, exists := result[key]; exists {
			return fmt.Errorf("duplicate page id %q", ja.ID)
		}
		result[key] = LocalPage{Dir: dir, Rel: rel, ja: ja, en: en, JAContent: jac, ENContent: enc}
		return nil
	})
	if errors.Is(err, os.ErrNotExist) {
		return result, nil
	}
	return result, err
}

type LocalPage struct {
	Dir, Rel, JAContent, ENContent string
	ja, en                         FrontMatter
}

func (l LocalPage) Attachments() []Attachment { return l.ja.Attachments }
func (l LocalPage) Slug() string              { return l.ja.Slug }

func PageFromLocal(l LocalPage, all map[string]LocalPage) (Page, error) {
	if l.ja.ID == "" && l.ja.Status != "published" {
		return Page{}, fmt.Errorf("%s: new and managed pages require status: published", l.Rel)
	}
	if filepath.Base(l.Dir) != l.ja.Slug {
		return Page{}, fmt.Errorf("%s: directory name must match slug", l.Rel)
	}
	var parentID *string
	parentDir := filepath.Dir(l.Rel)
	if parentDir != "." {
		for id, c := range all {
			if c.Rel == parentDir {
				if strings.HasPrefix(id, "new:") {
					return Page{}, fmt.Errorf("%w: %s", ErrParentNotCreated, l.Rel)
				}
				v := id
				parentID = &v
				break
			}
		}
		if parentID == nil {
			return Page{}, fmt.Errorf("%s: parent directory is not a wiki page", l.Rel)
		}
	}
	if (l.ja.ParentSlug == nil) != (parentID == nil) || (l.ja.ParentSlug != nil && filepath.Base(parentDir) != *l.ja.ParentSlug) {
		return Page{}, fmt.Errorf("%s: parent_slug does not match directory hierarchy", l.Rel)
	}
	attachments := append([]Attachment(nil), l.ja.Attachments...)
	for i := range attachments {
		clean := filepath.Clean(attachments[i].Path)
		if attachments[i].Path == "" || filepath.IsAbs(clean) || clean == "assets" || !strings.HasPrefix(filepath.ToSlash(clean), "assets/") || strings.Contains(filepath.ToSlash(clean), "../") {
			return Page{}, fmt.Errorf("%s: attachment path must stay under assets/", l.Rel)
		}
		raw, err := os.ReadFile(filepath.Join(l.Dir, clean))
		if err != nil {
			return Page{}, fmt.Errorf("%s: attachment %s: %w", l.Rel, attachments[i].Path, err)
		}
		attachments[i].SHA256 = digest(raw)
	}
	return Page{ID: l.ja.ID, Slug: l.ja.Slug, ParentID: parentID, JA: Locale{Title: l.ja.Title, Summary: l.ja.Summary, TranslationStatus: l.ja.TranslationStatus, Content: l.JAContent}, EN: Locale{Title: l.en.Title, Summary: l.en.Summary, TranslationStatus: l.en.TranslationStatus, Content: l.ENContent}, Status: l.ja.Status, PageType: stringPointer(l.ja.PageType), PageMetadata: l.ja.PageMetadata, SortOrder: l.ja.SortOrder, Visibility: l.ja.Visibility, GeneralRole: l.ja.GeneralRole, ChapterID: l.ja.ChapterID, Tags: l.ja.Tags, Access: l.ja.Access, Sources: l.ja.Sources, Attachments: attachments}, nil
}
func stringPointer(value any) *string {
	if value == nil {
		return nil
	}
	s, ok := value.(string)
	if !ok || s == "" {
		return nil
	}
	return &s
}
func RenderRemote(p Page, language string) string {
	var fm FrontMatter
	var content string
	if language == "ja" {
		fm = FrontMatter{GDGWiki: 1, ID: p.ID, Slug: p.Slug, Language: "ja", Title: p.JA.Title, Summary: p.JA.Summary, TranslationStatus: p.JA.TranslationStatus, Status: p.Status}
		content = p.JA.Content
	} else {
		fm = FrontMatter{GDGWiki: 1, ID: p.ID, Slug: p.Slug, Language: "en", Title: p.EN.Title, Summary: p.EN.Summary, TranslationStatus: p.EN.TranslationStatus}
		content = p.EN.Content
	}
	raw, _ := renderMarkdown(fm, content)
	return string(raw)
}
func WriteConflict(dir, baseJA, localJA, remoteJA, baseEN, localEN, remoteEN string) error {
	merge := func(base, local, remote string) string {
		return "<<<<<<< LOCAL\n" + local + "||||||| BASE\n" + base + "=======\n" + remote + ">>>>>>> WIKI\n"
	}
	if err := os.WriteFile(filepath.Join(dir, "ja.md"), []byte(merge(baseJA, localJA, remoteJA)), 0644); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "en.md"), []byte(merge(baseEN, localEN, remoteEN)), 0644)
}

// ConflictFiles returns Markdown files that still contain the Git-style markers
// written by WriteConflict. It deliberately scans before YAML parsing because a
// front-matter conflict is not valid YAML until the user resolves it.
func ConflictFiles(root string) ([]string, error) {
	var files []string
	err := filepath.WalkDir(filepath.Join(root, "pages"), func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || (d.Name() != "ja.md" && d.Name() != "en.md") {
			return err
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if strings.Contains(string(raw), "<<<<<<< LOCAL") || strings.Contains(string(raw), ">>>>>>> WIKI") {
			files = append(files, path)
		}
		return nil
	})
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	return files, err
}
func sortedKeys[M any](m map[string]M) []string {
	r := make([]string, 0, len(m))
	for k := range m {
		r = append(r, k)
	}
	sort.Strings(r)
	return r
}
