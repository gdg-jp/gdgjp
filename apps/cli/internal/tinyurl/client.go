// Package tinyurl is the gdg CLI client for the tinyurl (url.gdgs.jp)
// authenticated CLI/agent API: links, tags, folders, custom domains, and
// campaigns with channels, sources, and aggregate analytics. It wraps the
// generated OpenAPI client in openapigen.
package tinyurl

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	openapigen "github.com/gdg-jp/gdgjp/cli/internal/tinyurl/openapigen"
)

const defaultBaseURL = "https://url.gdgs.jp"

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
	return fmt.Sprintf("tinyurl request failed (%d): %s", e.StatusCode, e.Message)
}

func (e *HTTPError) HTTPStatus() int { return e.StatusCode }

// Typed models re-exported so command code and tests never import openapigen.
type (
	Domain                           = openapigen.Domain
	DomainList                       = openapigen.DomainList
	DomainResponse                   = openapigen.DomainResponse
	DomainDeleteResult               = openapigen.DomainDeleteResult
	Campaign                         = openapigen.Campaign
	CliCampaignResponse              = openapigen.CliCampaignResponse
	CliCampaignList                  = openapigen.CliCampaignList
	CampaignChannel                  = openapigen.CampaignChannel
	CliCampaignChannelResponse       = openapigen.CliCampaignChannelResponse
	CliCampaignChannelList           = openapigen.CliCampaignChannelList
	CampaignChannelSource            = openapigen.CampaignChannelSource
	CliCampaignChannelSourceResponse = openapigen.CliCampaignChannelSourceResponse
	CliCampaignChannelSourceList     = openapigen.CliCampaignChannelSourceList
	CliCampaignAnalyticsResponse     = openapigen.CliCampaignAnalyticsResponse
	CliArchiveResult                 = openapigen.CliArchiveResult
)

// Page carries the API's common --limit/--cursor pagination flags. Nil
// fields are omitted from the request.
type Page struct {
	Limit  *int
	Cursor *string
}

// ListLinksOptions narrows a links list. Nil fields are omitted.
type ListLinksOptions struct {
	FolderID *int
	TagID    *int
	Page
}

// ListDomainsOptions narrows a domains list. Nil fields are omitted.
type ListDomainsOptions struct {
	ChapterID *int
	Page
}

// ListCampaignOptions narrows a campaigns/channels/sources list.
type ListCampaignOptions struct {
	IncludeArchived *bool
	Page
}

// AnalyticsOptions is the bounded window for campaign analytics. From and To
// are required; Bucket is optional ("hour" or "day").
type AnalyticsOptions struct {
	From   time.Time
	To     time.Time
	Bucket *string
}

func NewClient() *Client {
	base := os.Getenv("GDG_TINYURL_URL")
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

// query adds fixed query parameters to a request. Used for the tags/folders
// list endpoints, whose generated methods take no typed params but whose
// server honours the shared --limit/--cursor flags.
func query(params map[string]string) openapigen.RequestEditorFn {
	return func(_ context.Context, request *http.Request) error {
		q := request.URL.Query()
		for key, value := range params {
			if value != "" {
				q.Set(key, value)
			}
		}
		request.URL.RawQuery = q.Encode()
		return nil
	}
}

func (p Page) query() map[string]string {
	out := map[string]string{}
	if p.Limit != nil {
		out["limit"] = strconv.Itoa(*p.Limit)
	}
	if p.Cursor != nil {
		out["cursor"] = *p.Cursor
	}
	return out
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

// raw passes an endpoint's success body straight through, so a command's
// stdout is byte-for-byte the server's response. Non-2xx becomes *HTTPError.
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

// --- links -----------------------------------------------------------------

func (c *Client) ListLinks(ctx context.Context, token string, options ListLinksOptions) (json.RawMessage, error) {
	params := &openapigen.ListCliLinksParams{
		FolderId: options.FolderID,
		TagId:    options.TagID,
		Limit:    options.Limit,
		Cursor:   options.Cursor,
	}
	res, err := c.generatedClient().ListCliLinksWithResponse(ctx, params, bearer(token))
	if err != nil {
		return nil, err
	}
	return raw(res.StatusCode(), res.Body)
}

func (c *Client) CreateLink(ctx context.Context, token string, body map[string]any) (json.RawMessage, error) {
	reader, err := jsonReader(body)
	if err != nil {
		return nil, err
	}
	res, err := c.generatedClient().CreateCliLinkWithBodyWithResponse(ctx, "application/json", reader, bearer(token))
	if err != nil {
		return nil, err
	}
	return raw(res.StatusCode(), res.Body)
}

func (c *Client) GetLink(ctx context.Context, token, id string) (json.RawMessage, error) {
	res, err := c.generatedClient().GetCliLinkWithResponse(ctx, id, bearer(token))
	if err != nil {
		return nil, err
	}
	return raw(res.StatusCode(), res.Body)
}

func (c *Client) UpdateLink(ctx context.Context, token, id string, body map[string]any) (json.RawMessage, error) {
	reader, err := jsonReader(body)
	if err != nil {
		return nil, err
	}
	res, err := c.generatedClient().UpdateCliLinkWithBodyWithResponse(ctx, id, "application/json", reader, bearer(token))
	if err != nil {
		return nil, err
	}
	return raw(res.StatusCode(), res.Body)
}

func (c *Client) DeleteLink(ctx context.Context, token, id string) (json.RawMessage, error) {
	res, err := c.generatedClient().DeleteCliLinkWithResponse(ctx, id, bearer(token))
	if err != nil {
		return nil, err
	}
	return raw(res.StatusCode(), res.Body)
}

// --- tags ----------------------------------------------------------------

func (c *Client) ListTags(ctx context.Context, token string, page Page) (json.RawMessage, error) {
	res, err := c.generatedClient().ListCliTagsWithResponse(ctx, bearer(token), query(page.query()))
	if err != nil {
		return nil, err
	}
	return raw(res.StatusCode(), res.Body)
}

func (c *Client) CreateTag(ctx context.Context, token string, body map[string]any) (json.RawMessage, error) {
	reader, err := jsonReader(body)
	if err != nil {
		return nil, err
	}
	res, err := c.generatedClient().CreateCliTagWithBodyWithResponse(ctx, "application/json", reader, bearer(token))
	if err != nil {
		return nil, err
	}
	return raw(res.StatusCode(), res.Body)
}

func (c *Client) UpdateTag(ctx context.Context, token string, id int, body map[string]any) (json.RawMessage, error) {
	reader, err := jsonReader(body)
	if err != nil {
		return nil, err
	}
	res, err := c.generatedClient().UpdateCliTagWithBodyWithResponse(ctx, id, "application/json", reader, bearer(token))
	if err != nil {
		return nil, err
	}
	return raw(res.StatusCode(), res.Body)
}

func (c *Client) DeleteTag(ctx context.Context, token string, id int) (json.RawMessage, error) {
	res, err := c.generatedClient().DeleteCliTagWithResponse(ctx, id, bearer(token))
	if err != nil {
		return nil, err
	}
	return raw(res.StatusCode(), res.Body)
}

// --- folders -------------------------------------------------------------

func (c *Client) ListFolders(ctx context.Context, token string, page Page) (json.RawMessage, error) {
	res, err := c.generatedClient().ListCliFoldersWithResponse(ctx, bearer(token), query(page.query()))
	if err != nil {
		return nil, err
	}
	return raw(res.StatusCode(), res.Body)
}

func (c *Client) GetFolder(ctx context.Context, token string, id int) (json.RawMessage, error) {
	res, err := c.generatedClient().GetCliFolderWithResponse(ctx, id, bearer(token))
	if err != nil {
		return nil, err
	}
	return raw(res.StatusCode(), res.Body)
}

func (c *Client) CreateFolder(ctx context.Context, token string, body map[string]any) (json.RawMessage, error) {
	reader, err := jsonReader(body)
	if err != nil {
		return nil, err
	}
	res, err := c.generatedClient().CreateCliFolderWithBodyWithResponse(ctx, "application/json", reader, bearer(token))
	if err != nil {
		return nil, err
	}
	return raw(res.StatusCode(), res.Body)
}

func (c *Client) UpdateFolder(ctx context.Context, token string, id int, body map[string]any) (json.RawMessage, error) {
	reader, err := jsonReader(body)
	if err != nil {
		return nil, err
	}
	res, err := c.generatedClient().UpdateCliFolderWithBodyWithResponse(ctx, id, "application/json", reader, bearer(token))
	if err != nil {
		return nil, err
	}
	return raw(res.StatusCode(), res.Body)
}

func (c *Client) DeleteFolder(ctx context.Context, token string, id int) (json.RawMessage, error) {
	res, err := c.generatedClient().DeleteCliFolderWithResponse(ctx, id, bearer(token))
	if err != nil {
		return nil, err
	}
	return raw(res.StatusCode(), res.Body)
}

// --- domains -----------------------------------------------------------------

func (c *Client) ListDomains(ctx context.Context, token string, options ListDomainsOptions) (DomainList, error) {
	params := &openapigen.ListCliDomainsParams{
		ChapterId: options.ChapterID,
		Limit:     options.Limit,
		Cursor:    options.Cursor,
	}
	res, err := c.generatedClient().ListCliDomainsWithResponse(ctx, params, bearer(token))
	if err != nil {
		return DomainList{}, err
	}
	var out DomainList
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) GetDomain(ctx context.Context, token string, id int) (DomainResponse, error) {
	res, err := c.generatedClient().GetCliDomainWithResponse(ctx, id, bearer(token))
	if err != nil {
		return DomainResponse{}, err
	}
	var out DomainResponse
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) CreateDomain(ctx context.Context, token string, body map[string]any) (DomainResponse, error) {
	reader, err := jsonReader(body)
	if err != nil {
		return DomainResponse{}, err
	}
	res, err := c.generatedClient().CreateCliDomainWithBodyWithResponse(ctx, "application/json", reader, bearer(token))
	if err != nil {
		return DomainResponse{}, err
	}
	var out DomainResponse
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) SyncDomain(ctx context.Context, token string, id int) (DomainResponse, error) {
	res, err := c.generatedClient().SyncCliDomainWithResponse(ctx, id, bearer(token))
	if err != nil {
		return DomainResponse{}, err
	}
	var out DomainResponse
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) DeleteDomain(ctx context.Context, token string, id int) (DomainDeleteResult, error) {
	res, err := c.generatedClient().DeleteCliDomainWithResponse(ctx, id, bearer(token))
	if err != nil {
		return DomainDeleteResult{}, err
	}
	var out DomainDeleteResult
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

// --- campaigns -----------------------------------------------------------------

func (c *Client) ListCampaigns(ctx context.Context, token string, options ListCampaignOptions) (CliCampaignList, error) {
	params := &openapigen.ListCliCampaignsParams{
		IncludeArchived: options.IncludeArchived,
		Limit:           options.Limit,
		Cursor:          options.Cursor,
	}
	res, err := c.generatedClient().ListCliCampaignsWithResponse(ctx, params, bearer(token))
	if err != nil {
		return CliCampaignList{}, err
	}
	var out CliCampaignList
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) CreateCampaign(ctx context.Context, token string, body map[string]any) (CliCampaignResponse, error) {
	reader, err := jsonReader(body)
	if err != nil {
		return CliCampaignResponse{}, err
	}
	res, err := c.generatedClient().CreateCliCampaignWithBodyWithResponse(ctx, "application/json", reader, bearer(token))
	if err != nil {
		return CliCampaignResponse{}, err
	}
	var out CliCampaignResponse
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) GetCampaign(ctx context.Context, token string, id int) (CliCampaignResponse, error) {
	res, err := c.generatedClient().GetCliCampaignWithResponse(ctx, id, bearer(token))
	if err != nil {
		return CliCampaignResponse{}, err
	}
	var out CliCampaignResponse
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) UpdateCampaign(ctx context.Context, token string, id int, body map[string]any) (CliCampaignResponse, error) {
	reader, err := jsonReader(body)
	if err != nil {
		return CliCampaignResponse{}, err
	}
	res, err := c.generatedClient().UpdateCliCampaignWithBodyWithResponse(ctx, id, "application/json", reader, bearer(token))
	if err != nil {
		return CliCampaignResponse{}, err
	}
	var out CliCampaignResponse
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) ArchiveCampaign(ctx context.Context, token string, id int) (CliArchiveResult, error) {
	res, err := c.generatedClient().ArchiveCliCampaignWithResponse(ctx, id, bearer(token))
	if err != nil {
		return CliArchiveResult{}, err
	}
	var out CliArchiveResult
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) RestoreCampaign(ctx context.Context, token string, id int) (CliCampaignResponse, error) {
	res, err := c.generatedClient().RestoreCliCampaignWithResponse(ctx, id, bearer(token))
	if err != nil {
		return CliCampaignResponse{}, err
	}
	var out CliCampaignResponse
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

// --- campaign channels -----------------------------------------------------

func (c *Client) ListChannels(ctx context.Context, token string, campaignID int, options ListCampaignOptions) (CliCampaignChannelList, error) {
	params := &openapigen.ListCliCampaignChannelsParams{
		IncludeArchived: options.IncludeArchived,
		Limit:           options.Limit,
		Cursor:          options.Cursor,
	}
	res, err := c.generatedClient().ListCliCampaignChannelsWithResponse(ctx, campaignID, params, bearer(token))
	if err != nil {
		return CliCampaignChannelList{}, err
	}
	var out CliCampaignChannelList
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) CreateChannel(ctx context.Context, token string, campaignID int, body map[string]any) (CliCampaignChannelResponse, error) {
	reader, err := jsonReader(body)
	if err != nil {
		return CliCampaignChannelResponse{}, err
	}
	res, err := c.generatedClient().CreateCliCampaignChannelWithBodyWithResponse(ctx, campaignID, "application/json", reader, bearer(token))
	if err != nil {
		return CliCampaignChannelResponse{}, err
	}
	var out CliCampaignChannelResponse
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) UpdateChannel(ctx context.Context, token string, campaignID, channelID int, body map[string]any) (CliCampaignChannelResponse, error) {
	reader, err := jsonReader(body)
	if err != nil {
		return CliCampaignChannelResponse{}, err
	}
	res, err := c.generatedClient().UpdateCliCampaignChannelWithBodyWithResponse(ctx, campaignID, channelID, "application/json", reader, bearer(token))
	if err != nil {
		return CliCampaignChannelResponse{}, err
	}
	var out CliCampaignChannelResponse
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) ArchiveChannel(ctx context.Context, token string, campaignID, channelID int) (CliArchiveResult, error) {
	res, err := c.generatedClient().ArchiveCliCampaignChannelWithResponse(ctx, campaignID, channelID, bearer(token))
	if err != nil {
		return CliArchiveResult{}, err
	}
	var out CliArchiveResult
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) RestoreChannel(ctx context.Context, token string, campaignID, channelID int) (CliCampaignChannelResponse, error) {
	res, err := c.generatedClient().RestoreCliCampaignChannelWithResponse(ctx, campaignID, channelID, bearer(token))
	if err != nil {
		return CliCampaignChannelResponse{}, err
	}
	var out CliCampaignChannelResponse
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

// --- campaign channel sources --------------------------------------------

func (c *Client) ListSources(ctx context.Context, token string, campaignID, channelID int, options ListCampaignOptions) (CliCampaignChannelSourceList, error) {
	params := &openapigen.ListCliCampaignChannelSourcesParams{
		IncludeArchived: options.IncludeArchived,
		Limit:           options.Limit,
		Cursor:          options.Cursor,
	}
	res, err := c.generatedClient().ListCliCampaignChannelSourcesWithResponse(ctx, campaignID, channelID, params, bearer(token))
	if err != nil {
		return CliCampaignChannelSourceList{}, err
	}
	var out CliCampaignChannelSourceList
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) CreateSource(ctx context.Context, token string, campaignID, channelID int, body map[string]any) (CliCampaignChannelSourceResponse, error) {
	reader, err := jsonReader(body)
	if err != nil {
		return CliCampaignChannelSourceResponse{}, err
	}
	res, err := c.generatedClient().CreateCliCampaignChannelSourceWithBodyWithResponse(ctx, campaignID, channelID, "application/json", reader, bearer(token))
	if err != nil {
		return CliCampaignChannelSourceResponse{}, err
	}
	var out CliCampaignChannelSourceResponse
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) UpdateSource(ctx context.Context, token string, campaignID, channelID, sourceID int, body map[string]any) (CliCampaignChannelSourceResponse, error) {
	reader, err := jsonReader(body)
	if err != nil {
		return CliCampaignChannelSourceResponse{}, err
	}
	res, err := c.generatedClient().UpdateCliCampaignChannelSourceWithBodyWithResponse(ctx, campaignID, channelID, sourceID, "application/json", reader, bearer(token))
	if err != nil {
		return CliCampaignChannelSourceResponse{}, err
	}
	var out CliCampaignChannelSourceResponse
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) ArchiveSource(ctx context.Context, token string, campaignID, channelID, sourceID int) (CliArchiveResult, error) {
	res, err := c.generatedClient().ArchiveCliCampaignChannelSourceWithResponse(ctx, campaignID, channelID, sourceID, bearer(token))
	if err != nil {
		return CliArchiveResult{}, err
	}
	var out CliArchiveResult
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) RestoreSource(ctx context.Context, token string, campaignID, channelID, sourceID int) (CliCampaignChannelSourceResponse, error) {
	res, err := c.generatedClient().RestoreCliCampaignChannelSourceWithResponse(ctx, campaignID, channelID, sourceID, bearer(token))
	if err != nil {
		return CliCampaignChannelSourceResponse{}, err
	}
	var out CliCampaignChannelSourceResponse
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

// --- campaign analytics --------------------------------------------------

// MaxAnalyticsRangeDays mirrors the server's cap (campaign-cli-analytics.ts).
const MaxAnalyticsRangeDays = 366

// ValidateAnalyticsWindow performs the same order/366-day checks the server
// does, so the CLI rejects a bad window before calling the API.
func ValidateAnalyticsWindow(from, to time.Time) error {
	if from.After(to) {
		return fmt.Errorf("--from must not be after --to")
	}
	startDay := from.UTC().Truncate(24 * time.Hour)
	endDay := to.UTC().Truncate(24 * time.Hour)
	rangeDays := int(endDay.Sub(startDay)/(24*time.Hour)) + 1
	if rangeDays > MaxAnalyticsRangeDays {
		return fmt.Errorf("the date range cannot exceed %d days", MaxAnalyticsRangeDays)
	}
	return nil
}

func (c *Client) CampaignAnalytics(ctx context.Context, token string, campaignID int, options AnalyticsOptions) (CliCampaignAnalyticsResponse, error) {
	params := &openapigen.GetCliCampaignAnalyticsParams{
		From: options.From,
		To:   options.To,
	}
	if options.Bucket != nil {
		bucket := openapigen.GetCliCampaignAnalyticsParamsBucket(*options.Bucket)
		params.Bucket = &bucket
	}
	res, err := c.generatedClient().GetCliCampaignAnalyticsWithResponse(ctx, campaignID, params, bearer(token))
	if err != nil {
		return CliCampaignAnalyticsResponse{}, err
	}
	var out CliCampaignAnalyticsResponse
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}
