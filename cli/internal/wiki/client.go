// Package wiki is the client and on-disk representation used by `gdg wiki`.
package wiki

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	openapigen "github.com/gdg-jp/gdgjp/cli/internal/wiki/openapigen"
)

const defaultBaseURL = "https://wiki.gdgs.jp"

type Client struct {
	BaseURL    string
	HTTPClient *http.Client
	generated  *openapigen.ClientWithResponses
}
type HTTPError struct {
	StatusCode int
	Message    string
}

func (e *HTTPError) Error() string {
	return fmt.Sprintf("wiki request failed (%d): %s", e.StatusCode, e.Message)
}
func NewClient() *Client {
	base := os.Getenv("GDG_WIKI_URL")
	if base == "" {
		base = defaultBaseURL
	}
	return NewClientAt(base)
}

// NewClientAt creates a Wiki API client for a Git remote's origin. The
// gdg-wiki transport address includes an API path, while the generated client
// owns those paths itself, so callers pass only the origin here.
func NewClientAt(base string) *Client {
	client := &Client{BaseURL: strings.TrimRight(base, "/"), HTTPClient: http.DefaultClient}
	client.generatedClient()
	return client
}

func (c *Client) generatedClient() *openapigen.ClientWithResponses {
	if c.generated == nil {
		client, err := openapigen.NewClientWithResponses(c.BaseURL, openapigen.WithHTTPClient(c.HTTPClient))
		if err != nil {
			panic(err)
		}
		c.generated = client
	}
	return c.generated
}

func bearer(token string) openapigen.RequestEditorFn {
	return func(_ context.Context, request *http.Request) error {
		request.Header.Set("Authorization", "Bearer "+token)
		return nil
	}
}

type Locale struct {
	Title             string `json:"title"`
	Summary           string `json:"summary"`
	TranslationStatus string `json:"translationStatus"`
	Content           string `json:"content"`
}
type Attachment struct {
	ID          string `json:"id,omitempty"`
	R2Key       string `json:"r2Key,omitempty"`
	FileName    string `json:"fileName"`
	MimeType    string `json:"mimeType"`
	DownloadURL string `json:"downloadUrl,omitempty"`
	Path        string `json:"path,omitempty"`
	SHA256      string `json:"sha256,omitempty"`
}
type Page struct {
	ID           string       `json:"id,omitempty"`
	Slug         string       `json:"slug"`
	ParentID     *string      `json:"parentId,omitempty"`
	Revision     int          `json:"revision,omitempty"`
	JA           Locale       `json:"ja"`
	EN           Locale       `json:"en"`
	Status       string       `json:"status"`
	PageType     *string      `json:"pageType"`
	PageMetadata any          `json:"pageMetadata"`
	SortOrder    int          `json:"sortOrder"`
	Visibility   string       `json:"visibility"`
	GeneralRole  string       `json:"generalRole"`
	ChapterID    *string      `json:"chapterId"`
	Tags         []string     `json:"tags"`
	Access       any          `json:"access"`
	Sources      any          `json:"sources"`
	Attachments  []Attachment `json:"attachments"`
}
type Snapshot struct {
	Pages []Page `json:"pages"`
}
type SyncOperation struct {
	Kind             string `json:"kind"`
	ID               string `json:"id,omitempty"`
	ExpectedRevision int    `json:"expectedRevision,omitempty"`
	Page             *Page  `json:"page,omitempty"`
}
type SyncRequest struct {
	Operations []SyncOperation `json:"operations"`
}
type SyncResultPage struct {
	ID            string            `json:"id"`
	Slug          string            `json:"slug"`
	AttachmentIDs map[string]string `json:"attachmentIds"`
	Revision      int               `json:"revision"`
}
type SyncResult struct {
	OK    bool             `json:"ok"`
	Pages []SyncResultPage `json:"pages"`
}

func (c *Client) request(ctx context.Context, token, method, path string, body io.Reader, contentType string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	res, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	if res.StatusCode >= 200 && res.StatusCode < 300 {
		return res, nil
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	return nil, &HTTPError{StatusCode: res.StatusCode, Message: strings.TrimSpace(string(raw))}
}
func (c *Client) Snapshot(ctx context.Context, token string) (Snapshot, error) {
	res, err := c.generatedClient().GetWikiSnapshotWithResponse(ctx, bearer(token))
	if err != nil {
		return Snapshot{}, err
	}
	if res.StatusCode() < 200 || res.StatusCode() >= 300 {
		return Snapshot{}, &HTTPError{StatusCode: res.StatusCode(), Message: strings.TrimSpace(string(res.Body))}
	}
	var out Snapshot
	err = json.Unmarshal(res.Body, &out)
	return out, err
}
func (c *Client) Sync(ctx context.Context, token string, input SyncRequest) (SyncResult, error) {
	operations := make([]any, 0, len(input.Operations))
	for _, operation := range input.Operations {
		if operation.Kind == "archive" {
			operations = append(operations, map[string]any{"kind": "archive", "id": operation.ID, "expectedRevision": operation.ExpectedRevision})
			continue
		}
		p := operation.Page
		if p == nil {
			return SyncResult{}, fmt.Errorf("upsert operation has no page")
		}
		// Empty list fields are omitted from clone-generated YAML. YAML decoding
		// represents those omissions as nil, while the API deliberately requires
		// arrays for these fields. Preserve the clone/sync round trip by encoding
		// an omitted list as an empty JSON array rather than null.
		tags := p.Tags
		if tags == nil {
			tags = []string{}
		}
		attachments := p.Attachments
		if attachments == nil {
			attachments = []Attachment{}
		}
		page := map[string]any{
			"slug": p.Slug, "parentId": p.ParentID, "sortOrder": p.SortOrder, "ja": p.JA, "en": p.EN,
			"meta": map[string]any{"status": p.Status, "pageType": p.PageType, "pageMetadata": p.PageMetadata, "visibility": p.Visibility, "generalRole": p.GeneralRole, "chapterId": p.ChapterID, "tags": tags, "access": emptyArrayIfNil(p.Access), "sources": emptyArrayIfNil(p.Sources), "attachments": attachments},
		}
		if p.ID != "" {
			page["id"] = p.ID
		}
		upsert := map[string]any{"kind": "upsert", "page": page}
		if operation.ExpectedRevision > 0 {
			upsert["expectedRevision"] = operation.ExpectedRevision
		}
		operations = append(operations, upsert)
	}
	raw, err := json.Marshal(map[string]any{"operations": operations})
	if err != nil {
		return SyncResult{}, err
	}
	res, err := c.generatedClient().SyncWikiWithBodyWithResponse(ctx, "application/json", bytes.NewReader(raw), bearer(token))
	if err != nil {
		return SyncResult{}, err
	}
	if res.StatusCode() < 200 || res.StatusCode() >= 300 {
		return SyncResult{}, &HTTPError{StatusCode: res.StatusCode(), Message: strings.TrimSpace(string(res.Body))}
	}
	var out SyncResult
	err = json.Unmarshal(res.Body, &out)
	return out, err
}

func emptyArrayIfNil(value any) any {
	if value == nil {
		return []any{}
	}
	return value
}
func (c *Client) Download(ctx context.Context, token, rawURL string) ([]byte, error) {
	path := rawURL
	if strings.HasPrefix(rawURL, c.BaseURL) {
		path = strings.TrimPrefix(rawURL, c.BaseURL)
	}
	res, err := c.request(ctx, token, http.MethodGet, path, nil, "")
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	return io.ReadAll(res.Body)
}

// Upload replaces bytes for an attachment allocated by Sync.
func (c *Client) Upload(ctx context.Context, token, attachmentID string, data []byte, mime string) error {
	res, err := c.generatedClient().UploadWikiAttachmentWithBodyWithResponse(ctx, attachmentID, mime, bytes.NewReader(data), bearer(token))
	if err != nil {
		return err
	}
	if res.StatusCode() < 200 || res.StatusCode() >= 300 {
		return &HTTPError{StatusCode: res.StatusCode(), Message: strings.TrimSpace(string(res.Body))}
	}
	return nil
}
