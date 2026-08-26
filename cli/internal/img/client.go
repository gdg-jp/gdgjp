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
	CliImage         = openapigen.CliImage
	CliImageList     = openapigen.CliImageList
	CliImageResponse = openapigen.CliImageResponse
	CliReplaceResult = openapigen.CliReplaceResult
	CliMobileResult  = openapigen.CliMobileResult
	CliDeleteResult  = openapigen.CliDeleteResult
	UploadResult     = openapigen.UploadResult
)

// ListOptions narrows a List call. Zero-value fields are omitted from the request.
type ListOptions struct {
	ChapterID *int
	Limit     *int
	Cursor    *string
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

// errorMessage extracts the server's { "error": string } envelope, falling
// back to the raw trimmed body when it isn't that shape.
func errorMessage(body []byte) string {
	var envelope struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(body, &envelope); err == nil && envelope.Error != "" {
		return envelope.Error
	}
	return strings.TrimSpace(string(body))
}

// multipartFile builds a multipart/form-data body with the file at filePath
// under fieldName, plus any additional string fields.
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

func (c *Client) Delete(ctx context.Context, token, id string) (CliDeleteResult, error) {
	res, err := c.generatedClient().DeleteCliImageWithResponse(ctx, id, bearer(token))
	if err != nil {
		return CliDeleteResult{}, err
	}
	var out CliDeleteResult
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}
