package img

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"os"
	"path"
	"strconv"
	"strings"

	openapigen "github.com/gdg-jp/gdgjp/cli/internal/img/openapigen"
)

const defaultBaseURL = "https://img.gdgs.jp"

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
	return fmt.Sprintf("img request failed (%d): %s", e.StatusCode, e.Message)
}

func (e *HTTPError) HTTPStatus() int { return e.StatusCode }

type (
	CliImage           = openapigen.CliImage
	CliImageList       = openapigen.CliImageList
	CliImageResponse   = openapigen.CliImageResponse
	CliReplaceResult   = openapigen.CliReplaceResult
	CliMobileResult    = openapigen.CliMobileResult
	CliDeleteResult    = openapigen.CliDeleteResult
	UploadResult       = openapigen.UploadResult
	Folder             = openapigen.Folder
	FolderResponse     = openapigen.FolderResponse
	FolderList         = openapigen.FolderList
	FolderDeleteResult = openapigen.FolderDeleteResult
)

type ListOptions struct {
	ChapterID *int
	FolderID  *string
	Limit     *int
	Cursor    *string
}

// ImagePatch describes a partial update to an image (PATCH
// /api/cli/v1/images/:id): only fields whose Set* flag is true are sent, so
// omitted fields are left untouched server-side. Built as a raw JSON map
// rather than the generated request struct, because the generated struct
// serializes its nullable fields (slug, folderId) unconditionally — using it
// directly would silently clear whichever of those two the caller didn't
// intend to touch.
type ImagePatch struct {
	SetSlug bool
	Slug    *string

	SetFolderID bool
	FolderID    *int

	SetChapterID bool
	ChapterID    int
}

func (p ImagePatch) toJSON() ([]byte, error) {
	body := map[string]any{}
	if p.SetSlug {
		body["slug"] = p.Slug
	}
	if p.SetFolderID {
		body["folderId"] = p.FolderID
	}
	if p.SetChapterID {
		body["chapterId"] = p.ChapterID
	}
	return json.Marshal(body)
}

func NewClient() *Client {
	base := os.Getenv("GDG_IMG_URL")
	if base == "" {
		base = defaultBaseURL
	}
	return NewClientAt(base)
}

func NewClientAt(baseURL string) *Client {
	client := &Client{BaseURL: strings.TrimRight(baseURL, "/"), HTTPClient: http.DefaultClient}
	client.generatedClient()
	return client
}

func (c *Client) generatedClient() *openapigen.ClientWithResponses {
	if c.generated == nil {
		generated, err := openapigen.NewClientWithResponses(c.BaseURL, openapigen.WithHTTPClient(c.HTTPClient))
		if err != nil {
			panic(err)
		}
		c.generated = generated
	}
	return c.generated
}

func bearer(token string) openapigen.RequestEditorFn {
	return func(_ context.Context, request *http.Request) error {
		request.Header.Set("Authorization", "Bearer "+token)
		return nil
	}
}

func decodeResponse[T any](status int, body []byte, out *T) error {
	if status < 200 || status >= 300 {
		return &HTTPError{StatusCode: status, Message: errorMessage(body)}
	}
	if out == nil || len(body) == 0 {
		return nil
	}
	return json.Unmarshal(body, out)
}

func errorMessage(body []byte) string {
	var envelope struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(body, &envelope); err == nil && envelope.Error != "" {
		return envelope.Error
	}
	return strings.TrimSpace(string(body))
}

func multipartFile(filePath, fieldName string, fields map[string]string) (io.Reader, string, error) {
	contents, err := os.ReadFile(filePath)
	if err != nil {
		return nil, "", err
	}
	var payload bytes.Buffer
	writer := multipart.NewWriter(&payload)
	contentType := mime.TypeByExtension(path.Ext(filePath))
	if contentType == "" {
		return nil, "", fmt.Errorf("unsupported image extension: %s", path.Ext(filePath))
	}
	headers := make(textproto.MIMEHeader)
	headers.Set("Content-Disposition", fmt.Sprintf(`form-data; name=%q; filename=%q`, fieldName, path.Base(filePath)))
	headers.Set("Content-Type", contentType)
	part, err := writer.CreatePart(headers)
	if err != nil {
		return nil, "", err
	}
	if _, err := part.Write(contents); err != nil {
		return nil, "", err
	}
	for name, value := range fields {
		if err := writer.WriteField(name, value); err != nil {
			return nil, "", err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, "", err
	}
	return &payload, writer.FormDataContentType(), nil
}

func (c *Client) List(ctx context.Context, token string, options ListOptions) (CliImageList, error) {
	params := &openapigen.ListCliImagesParams{
		ChapterId: options.ChapterID,
		FolderId:  options.FolderID,
		Limit:     options.Limit,
		Cursor:    options.Cursor,
	}
	res, err := c.generatedClient().ListCliImagesWithResponse(ctx, params, bearer(token))
	if err != nil {
		return CliImageList{}, err
	}
	var out CliImageList
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) Get(ctx context.Context, token, id string) (CliImageResponse, error) {
	res, err := c.generatedClient().GetCliImageWithResponse(ctx, id, bearer(token))
	if err != nil {
		return CliImageResponse{}, err
	}
	var out CliImageResponse
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) Upload(ctx context.Context, token, filePath string, chapterID *int) (UploadResult, error) {
	fields := map[string]string{}
	if chapterID != nil {
		fields["chapterId"] = strconv.Itoa(*chapterID)
	}
	body, contentType, err := multipartFile(filePath, "file", fields)
	if err != nil {
		return UploadResult{}, err
	}
	res, err := c.generatedClient().CreateCliImageWithBodyWithResponse(ctx, contentType, body, bearer(token))
	if err != nil {
		return UploadResult{}, err
	}
	var out UploadResult
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) Replace(ctx context.Context, token, id, filePath string) (CliReplaceResult, error) {
	body, contentType, err := multipartFile(filePath, "file", nil)
	if err != nil {
		return CliReplaceResult{}, err
	}
	res, err := c.generatedClient().ReplaceCliImageWithBodyWithResponse(ctx, id, contentType, body, bearer(token))
	if err != nil {
		return CliReplaceResult{}, err
	}
	var out CliReplaceResult
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) UploadMobile(ctx context.Context, token, id, filePath string) (CliMobileResult, error) {
	body, contentType, err := multipartFile(filePath, "file", nil)
	if err != nil {
		return CliMobileResult{}, err
	}
	res, err := c.generatedClient().UploadCliMobileImageWithBodyWithResponse(ctx, id, contentType, body, bearer(token))
	if err != nil {
		return CliMobileResult{}, err
	}
	var out CliMobileResult
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) UpdateImage(ctx context.Context, token, id string, patch ImagePatch) (CliImageResponse, error) {
	body, err := patch.toJSON()
	if err != nil {
		return CliImageResponse{}, err
	}
	res, err := c.generatedClient().UpdateCliImageWithBodyWithResponse(ctx, id, "application/json", bytes.NewReader(body), bearer(token))
	if err != nil {
		return CliImageResponse{}, err
	}
	var out CliImageResponse
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) SetSlug(ctx context.Context, token, id string, slug *string) (CliImageResponse, error) {
	return c.UpdateImage(ctx, token, id, ImagePatch{SetSlug: true, Slug: slug})
}

func (c *Client) Move(ctx context.Context, token, id string, folderID *int) (CliImageResponse, error) {
	return c.UpdateImage(ctx, token, id, ImagePatch{SetFolderID: true, FolderID: folderID})
}

func (c *Client) Share(ctx context.Context, token, id string, chapterID int) (CliImageResponse, error) {
	return c.UpdateImage(ctx, token, id, ImagePatch{SetChapterID: true, ChapterID: chapterID})
}

func (c *Client) Delete(ctx context.Context, token, id string) (CliDeleteResult, error) {
	res, err := c.generatedClient().DeleteCliImageWithResponse(ctx, id, bearer(token))
	if err != nil {
		return CliDeleteResult{}, err
	}
	var out CliDeleteResult
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

type ListFoldersOptions struct {
	ChapterID *int
	Limit     *int
	Cursor    *string
}

func (c *Client) ListFolders(ctx context.Context, token string, options ListFoldersOptions) (FolderList, error) {
	params := &openapigen.ListCliFoldersParams{
		ChapterId: options.ChapterID,
		Limit:     options.Limit,
		Cursor:    options.Cursor,
	}
	res, err := c.generatedClient().ListCliFoldersWithResponse(ctx, params, bearer(token))
	if err != nil {
		return FolderList{}, err
	}
	var out FolderList
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) GetFolder(ctx context.Context, token string, id int) (FolderResponse, error) {
	res, err := c.generatedClient().GetCliFolderWithResponse(ctx, id, bearer(token))
	if err != nil {
		return FolderResponse{}, err
	}
	var out FolderResponse
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) CreateFolder(ctx context.Context, token, name string, chapterID *int) (FolderResponse, error) {
	body := openapigen.CreateCliFolderJSONRequestBody{Name: name, ChapterId: chapterID}
	res, err := c.generatedClient().CreateCliFolderWithResponse(ctx, body, bearer(token))
	if err != nil {
		return FolderResponse{}, err
	}
	var out FolderResponse
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) UpdateFolder(ctx context.Context, token string, id int, name string) (FolderResponse, error) {
	body := openapigen.UpdateCliFolderJSONRequestBody{Name: name}
	res, err := c.generatedClient().UpdateCliFolderWithResponse(ctx, id, body, bearer(token))
	if err != nil {
		return FolderResponse{}, err
	}
	var out FolderResponse
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) DeleteFolder(ctx context.Context, token string, id int) (FolderDeleteResult, error) {
	res, err := c.generatedClient().DeleteCliFolderWithResponse(ctx, id, bearer(token))
	if err != nil {
		return FolderDeleteResult{}, err
	}
	var out FolderDeleteResult
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}
