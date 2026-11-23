package sns

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

	openapi_types "github.com/oapi-codegen/runtime/types"

	openapigen "github.com/gdg-jp/gdgjp/cli/internal/sns/openapigen"
)

const defaultBaseURL = "https://sns.gdgs.jp"

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
	return fmt.Sprintf("sns request failed (%d): %s", e.StatusCode, e.Message)
}

func (e *HTTPError) HTTPStatus() int { return e.StatusCode }

type Page struct {
	Limit  *int
	Cursor *string
}

type ListPostsOptions struct {
	ChapterID int
	Status    *string
	Page
}

func NewClient() *Client {
	base := os.Getenv("GDG_SNS_URL")
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

func errorMessage(body []byte) string {
	var envelope struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(body, &envelope); err == nil && envelope.Error != "" {
		return envelope.Error
	}
	return strings.TrimSpace(string(body))
}

func raw(status int, body []byte) (json.RawMessage, error) {
	if status < 200 || status >= 300 {
		return nil, &HTTPError{StatusCode: status, Message: errorMessage(body)}
	}
	return json.RawMessage(body), nil
}

func jsonReader(body map[string]any) (io.Reader, error) {
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(payload), nil
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

func (p Page) apply(params *openapigen.ListCliPostsParams) {
	params.Limit = p.Limit
	params.Cursor = p.Cursor
}

func (c *Client) ListPosts(ctx context.Context, token string, options ListPostsOptions) (json.RawMessage, error) {
	params := &openapigen.ListCliPostsParams{ChapterId: options.ChapterID}
	if options.Status != nil {
		status := openapigen.PostStatus(*options.Status)
		params.Status = &status
	}
	options.Page.apply(params)
	res, err := c.generatedClient().ListCliPostsWithResponse(ctx, params, bearer(token))
	if err != nil {
		return nil, err
	}
	return raw(res.StatusCode(), res.Body)
}

func (c *Client) CreatePost(ctx context.Context, token string, body map[string]any) (json.RawMessage, error) {
	reader, err := jsonReader(body)
	if err != nil {
		return nil, err
	}
	res, err := c.generatedClient().CreateCliPostWithBodyWithResponse(ctx, "application/json", reader, bearer(token))
	if err != nil {
		return nil, err
	}
	return raw(res.StatusCode(), res.Body)
}

func (c *Client) GetPost(ctx context.Context, token, id string) (json.RawMessage, error) {
	res, err := c.generatedClient().GetCliPostWithResponse(ctx, id, bearer(token))
	if err != nil {
		return nil, err
	}
	return raw(res.StatusCode(), res.Body)
}

func (c *Client) UpdatePost(ctx context.Context, token, id string, body map[string]any) (json.RawMessage, error) {
	reader, err := jsonReader(body)
	if err != nil {
		return nil, err
	}
	res, err := c.generatedClient().UpdateCliPostWithBodyWithResponse(ctx, id, "application/json", reader, bearer(token))
	if err != nil {
		return nil, err
	}
	return raw(res.StatusCode(), res.Body)
}

func (c *Client) DeletePost(ctx context.Context, token, id string) (json.RawMessage, error) {
	res, err := c.generatedClient().DeleteCliPostWithResponse(ctx, id, bearer(token))
	if err != nil {
		return nil, err
	}
	return raw(res.StatusCode(), res.Body)
}

type PublishResult struct {
	Body   json.RawMessage
	Status int
}

func (c *Client) PublishPost(ctx context.Context, token, id string) (PublishResult, error) {
	res, err := c.generatedClient().PublishCliPostWithResponse(ctx, id, bearer(token))
	if err != nil {
		return PublishResult{}, err
	}
	status := res.StatusCode()
	if (status >= 200 && status < 300) || status == http.StatusBadGateway {
		return PublishResult{Body: json.RawMessage(res.Body), Status: status}, nil
	}
	return PublishResult{}, &HTTPError{StatusCode: status, Message: errorMessage(res.Body)}
}

func (c *Client) AddMedia(ctx context.Context, token, postID, filePath string, sortOrder int, altText *string) (json.RawMessage, error) {
	fields := map[string]string{"sortOrder": strconv.Itoa(sortOrder)}
	if altText != nil {
		fields["altText"] = *altText
	}
	body, contentType, err := multipartFile(filePath, "file", fields)
	if err != nil {
		return nil, err
	}
	res, err := c.generatedClient().AttachCliPostMediaWithBodyWithResponse(ctx, postID, contentType, body, bearer(token))
	if err != nil {
		return nil, err
	}
	return raw(res.StatusCode(), res.Body)
}

func (c *Client) DeleteMedia(ctx context.Context, token, id string) (json.RawMessage, error) {
	res, err := c.generatedClient().DeleteCliMediaWithResponse(ctx, id, bearer(token))
	if err != nil {
		return nil, err
	}
	return raw(res.StatusCode(), res.Body)
}

func (c *Client) ListXAccounts(ctx context.Context, token string, chapterID int) (json.RawMessage, error) {
	params := &openapigen.ListCliXAccountsParams{ChapterId: chapterID}
	res, err := c.generatedClient().ListCliXAccountsWithResponse(ctx, params, bearer(token))
	if err != nil {
		return nil, err
	}
	return raw(res.StatusCode(), res.Body)
}

func (c *Client) RevokeXAccount(ctx context.Context, token, id, xUserID string) (json.RawMessage, error) {
	reader, err := jsonReader(map[string]any{"xUserId": xUserID})
	if err != nil {
		return nil, err
	}
	res, err := c.generatedClient().RevokeCliXAccountWithBodyWithResponse(ctx, id, "application/json", reader, bearer(token))
	if err != nil {
		return nil, err
	}
	return raw(res.StatusCode(), res.Body)
}

func (c *Client) ListContributors(ctx context.Context, token string, chapterID int, page Page) (json.RawMessage, error) {
	params := &openapigen.ListCliContributorsParams{
		ChapterId: chapterID,
		Limit:     page.Limit,
		Cursor:    page.Cursor,
	}
	res, err := c.generatedClient().ListCliContributorsWithResponse(ctx, params, bearer(token))
	if err != nil {
		return nil, err
	}
	return raw(res.StatusCode(), res.Body)
}

func (c *Client) AddContributor(ctx context.Context, token string, chapterID int, email string) (json.RawMessage, error) {
	reader, err := jsonReader(map[string]any{"chapterId": chapterID, "userEmail": email})
	if err != nil {
		return nil, err
	}
	res, err := c.generatedClient().AddCliContributorWithBodyWithResponse(ctx, "application/json", reader, bearer(token))
	if err != nil {
		return nil, err
	}
	return raw(res.StatusCode(), res.Body)
}

func (c *Client) RemoveContributor(ctx context.Context, token string, chapterID int, email string) (json.RawMessage, error) {
	params := &openapigen.RemoveCliContributorParams{
		ChapterId: chapterID,
		UserEmail: openapi_types.Email(email),
	}
	res, err := c.generatedClient().RemoveCliContributorWithResponse(ctx, params, bearer(token))
	if err != nil {
		return nil, err
	}
	return raw(res.StatusCode(), res.Body)
}
