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
	write(filepath.Join(root, "pages", "parent", "ja.md"), "---\ngdg_wiki: 1\nid: parent\nslug: parent\nlanguage: ja\ntitle: 親\ntranslation_status: human\nstatus: published\nparent_slug: null\nvisibility: restricted\ngeneral_role: viewer\n---\nparent")
	write(filepath.Join(root, "pages", "parent", "en.md"), "---\ngdg_wiki: 1\nid: parent\nslug: parent\nlanguage: en\ntitle: Parent\ntranslation_status: human\n---\nparent")
	write(filepath.Join(root, "pages", "parent", "child", "ja.md"), "---\ngdg_wiki: 1\nid: child\nslug: child\nlanguage: ja\ntitle: 子\ntranslation_status: human\nstatus: published\nparent_slug: parent\nvisibility: restricted\ngeneral_role: viewer\n---\nchild")
	write(filepath.Join(root, "pages", "parent", "child", "en.md"), "---\ngdg_wiki: 1\nid: child\nslug: child\nlanguage: en\ntitle: Child\ntranslation_status: human\n---\nchild")
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
}
