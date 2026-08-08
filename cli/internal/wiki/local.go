package wiki

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

type FrontMatter struct {
	GDGWiki           int          `yaml:"gdg_wiki"`
	ID                string       `yaml:"id,omitempty"`
	Slug              string       `yaml:"slug"`
	Language          string       `yaml:"language"`
	Title             string       `yaml:"title"`
	Summary           string       `yaml:"summary"`
	TranslationStatus string       `yaml:"translation_status"`
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

func digest(raw []byte) string {
	h := sha256.Sum256(raw)
	return hex.EncodeToString(h[:])
}

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

// WritePage writes a single-language page.md for the configured clone language.
func WritePage(root string, p Page, byID map[string]Page, token string, c *Client, lang string) error {
	if lang == "" {
		lang = "ja"
	}
	dir, err := pageDir(root, p, byID)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Join(dir, "assets"), 0755); err != nil {
		return err
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
	locale := p.JA
	if lang == "en" {
		locale = p.EN
	}
	if locale.Title == "" && locale.Content == "" && lang == "ja" && p.EN.Title != "" {
		locale = p.EN
		lang = "en"
	}
	fm := FrontMatter{
		GDGWiki: 1, ID: p.ID, Slug: p.Slug, Language: lang,
		Title: locale.Title, Summary: locale.Summary, TranslationStatus: locale.TranslationStatus,
		PageType: p.PageType, PageMetadata: p.PageMetadata, ParentSlug: parentSlug, SortOrder: p.SortOrder,
		Visibility: p.Visibility, GeneralRole: p.GeneralRole, ChapterID: p.ChapterID,
		Tags: p.Tags, Access: p.Access, Sources: p.Sources, Attachments: attachments,
	}
	pageMD, err := renderMarkdown(fm, locale.Content)
	if err != nil {
		return err
	}
	if err = os.WriteFile(filepath.Join(dir, "page.md"), pageMD, 0644); err != nil {
		return err
	}
	// Remove legacy bilingual files from older clones if present.
	_ = os.Remove(filepath.Join(dir, "ja.md"))
	_ = os.Remove(filepath.Join(dir, "en.md"))
	for _, a := range p.Attachments {
		if a.DownloadURL == "" {
			continue
		}
		data, err := c.Download(contextBackground(), token, a.DownloadURL)
		if err != nil {
			return err
		}
		if err = os.WriteFile(filepath.Join(dir, "assets", attachmentLocalName(a)), data, 0644); err != nil {
			return err
		}
	}
	return nil
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
	lang := "ja"
	if config, err := ReadConfig(root); err == nil {
		lang = config.Lang
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	return LocalPagesForLanguage(root, lang)
}

// LocalPagesForLanguage enforces the one locale configured for a clone. It is
// also used by the remote helper after extracting a Git tree, where .gdgwiki
// is intentionally absent because it is ignored.
func LocalPagesForLanguage(root, language string) (map[string]LocalPage, error) {
	if language != "ja" && language != "en" {
		return nil, fmt.Errorf("unsupported Wiki language %q", language)
	}
	result := map[string]LocalPage{}
	base := filepath.Join(root, "pages")
	err := filepath.WalkDir(base, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || d.Name() != "page.md" {
			return nil
		}
		dir := filepath.Dir(path)
		raw, e := os.ReadFile(path)
		if e != nil {
			return e
		}
		fm, body, e := splitMarkdown(raw)
		if e != nil {
			return fmt.Errorf("%s: %w", path, e)
		}
		if fm.GDGWiki != 1 || fm.Slug == "" || fm.Language != language {
			return fmt.Errorf("%s: invalid page metadata", dir)
		}
		rel, _ := filepath.Rel(base, dir)
		key := fm.ID
		if key == "" {
			key = "new:" + rel
		}
		if _, exists := result[key]; exists {
			return fmt.Errorf("duplicate page id %q", fm.ID)
		}
		result[key] = LocalPage{Dir: dir, Rel: rel, fm: fm, Content: body}
		return nil
	})
	if errors.Is(err, os.ErrNotExist) {
		return result, nil
	}
	return result, err
}

type LocalPage struct {
	Dir, Rel, Content string
	fm                FrontMatter
}

func (l LocalPage) Attachments() []Attachment { return l.fm.Attachments }
func (l LocalPage) Slug() string              { return l.fm.Slug }
func (l LocalPage) Language() string          { return l.fm.Language }

func PageFromLocal(l LocalPage, all map[string]LocalPage) (Page, error) {
	if filepath.Base(l.Dir) != l.fm.Slug {
		return Page{}, fmt.Errorf("%s: directory name must match slug", l.Rel)
	}
	var parentID *string
	parentDir := filepath.Dir(l.Rel)
	if parentDir != "." {
		for id, c := range all {
			if c.Rel == parentDir {
				if strings.HasPrefix(id, "new:") {
					return Page{}, fmt.Errorf("%s: new parent has not been created", l.Rel)
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
	if (l.fm.ParentSlug == nil) != (parentID == nil) || (l.fm.ParentSlug != nil && filepath.Base(parentDir) != *l.fm.ParentSlug) {
		return Page{}, fmt.Errorf("%s: parent_slug does not match directory hierarchy", l.Rel)
	}
	attachments := append([]Attachment(nil), l.fm.Attachments...)
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
	locale := Locale{
		Title:             l.fm.Title,
		Summary:           l.fm.Summary,
		TranslationStatus: l.fm.TranslationStatus,
		Content:           l.Content,
	}
	page := Page{
		ID: l.fm.ID, Slug: l.fm.Slug, ParentID: parentID,
		PageType: stringPointer(l.fm.PageType), PageMetadata: l.fm.PageMetadata,
		SortOrder: l.fm.SortOrder, Visibility: l.fm.Visibility, GeneralRole: l.fm.GeneralRole,
		ChapterID: l.fm.ChapterID, Tags: l.fm.Tags, Access: l.fm.Access, Sources: l.fm.Sources,
		Attachments: attachments,
	}
	if l.fm.Language == "en" {
		page.EN = locale
	} else {
		page.JA = locale
	}
	return page, nil
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
