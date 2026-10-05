package wiki

import "testing"

func TestPreserveExistingSharingKeepsWikiAppVisibility(t *testing.T) {
	chapter := "tokyo"
	previous := Page{
		Visibility:  "member",
		GeneralRole: "editor",
		ChapterID:   &chapter,
		Access: []map[string]any{
			{"subjectType": "chapter", "subjectKey": "tokyo", "subjectLabel": "Tokyo", "role": "viewer"},
		},
	}
	page := Page{Visibility: "restricted", GeneralRole: "viewer"}
	preserveExistingSharing(&page, previous)
	if page.Visibility != "member" || page.GeneralRole != "editor" || page.ChapterID == nil || *page.ChapterID != "tokyo" {
		t.Fatalf("preserved sharing = %#v", page)
	}
	if isEmptyAccess(page.Access) {
		t.Fatal("expected access grants to be preserved")
	}
}

func TestPreserveExistingSharingAllowsIntentionalPublish(t *testing.T) {
	previous := Page{Visibility: "restricted", GeneralRole: "viewer"}
	page := Page{Visibility: "public", GeneralRole: "viewer"}
	preserveExistingSharing(&page, previous)
	if page.Visibility != "public" {
		t.Fatalf("visibility = %q, want public", page.Visibility)
	}
}

func TestPreserveExistingSharingNoopsWhenBothAreDefaults(t *testing.T) {
	previous := Page{Visibility: "restricted", GeneralRole: "viewer"}
	page := Page{Visibility: "restricted", GeneralRole: "viewer"}
	preserveExistingSharing(&page, previous)
	if page.Visibility != "restricted" || page.GeneralRole != "viewer" {
		t.Fatalf("sharing = %#v", page)
	}
}
