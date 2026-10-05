package wiki

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPageFromLocalUsesDirectoryHierarchy(t *testing.T) {
	root := t.TempDir()
	write := func(path, text string) {
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(text), 0644); err != nil {
			t.Fatal(err)
		}
	}
	write(filepath.Join(root, "pages", "parent", "page.md"), "---\ngdg_wiki: 1\nid: parent\nslug: parent\nlanguage: ja\ntitle: 親\ntranslation_status: human\nparent_slug: null\nvisibility: restricted\ngeneral_role: viewer\n---\nparent")
	write(filepath.Join(root, "pages", "parent", "child", "page.md"), "---\ngdg_wiki: 1\nid: child\nslug: child\nlanguage: ja\ntitle: 子\ntranslation_status: human\nparent_slug: parent\nvisibility: restricted\ngeneral_role: viewer\n---\nchild")
	pages, err := LocalPages(root)
	if err != nil {
		t.Fatal(err)
	}
	page, err := PageFromLocal(pages["child"], pages)
	if err != nil {
		t.Fatal(err)
	}
	if page.ParentID == nil || *page.ParentID != "parent" {
		t.Fatalf("parent = %#v", page.ParentID)
	}
	if page.JA.Content != "child" || page.EN.Content != "" {
		t.Fatalf("expected single-locale JA page, got %#v", page)
	}
}

func TestWritePageCreatesPageMdOnly(t *testing.T) {
	root := t.TempDir()
	page := Page{
		ID: "p1", Slug: "venues", Visibility: "restricted", GeneralRole: "viewer",
		JA: Locale{Title: "会場", TranslationStatus: "human", Content: "本文"},
	}
	byID := map[string]Page{page.ID: page}
	if err := WritePage(root, page, byID, "", NewClient(), "ja"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "pages", "venues", "page.md")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "pages", "venues", "ja.md")); !os.IsNotExist(err) {
		t.Fatalf("ja.md should not exist: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "pages", "venues", "en.md")); !os.IsNotExist(err) {
		t.Fatalf("en.md should not exist: %v", err)
	}
	raw, err := os.ReadFile(filepath.Join(root, "pages", "venues", "page.md"))
	if err != nil {
		t.Fatal(err)
	}
	fm, _, err := splitMarkdown(raw)
	if err != nil {
		t.Fatal(err)
	}
	if fm.Language != "ja" {
		t.Fatalf("language = %q", fm.Language)
	}
}

func TestLocalPagesRejectsDifferentConfiguredLanguage(t *testing.T) {
	root := t.TempDir()
	if err := WriteConfig(root, CloneConfig{Lang: "ja"}); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(root, "pages", "example")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	markdown := "---\ngdg_wiki: 1\nslug: example\nlanguage: en\ntitle: Example\n---\nbody"
	if err := os.WriteFile(filepath.Join(dir, "page.md"), []byte(markdown), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := LocalPages(root); err == nil {
		t.Fatal("LocalPages accepted an en page in a ja clone")
	}
}
