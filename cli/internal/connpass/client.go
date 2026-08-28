package connpass

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
	"strings"
	"time"

	openapigen "github.com/gdg-jp/gdgjp/cli/internal/connpass/openapigen"
)

const defaultBaseURL = "https://connpass.gdgs.jp"

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
	return fmt.Sprintf("connpass request failed (%d): %s", e.StatusCode, e.Message)
}

func (e *HTTPError) HTTPStatus() int { return e.StatusCode }

type (
	CreateEventRequest      = openapigen.CreateEventRequest
	CreateSubEventRequest   = openapigen.CreateSubEventRequest
	Event                   = openapigen.Event
	EventFields             = openapigen.EventFields
	EventSummary            = openapigen.EventSummary
	Group                   = openapigen.Group
	Job                     = openapigen.Job
	JobStatus               = openapigen.JobStatus
	PublishEventRequest     = openapigen.PublishEventRequest
	SubEvent                = openapigen.SubEvent
	Survey                  = openapigen.Survey
	UpdateEventRequest      = openapigen.UpdateEventRequest
	UpsertConferenceRequest = openapigen.UpsertConferenceRequest
	UpsertGroupRequest      = openapigen.UpsertGroupRequest
	UpsertSurveyRequest     = openapigen.UpsertSurveyRequest
)

type ListEventsResponse struct {
	GroupID         string         `json:"groupId"`
	ResultsReturned int            `json:"resultsReturned"`
	Events          []EventSummary `json:"events"`
}

type GetEventResponse struct {
	GroupID string `json:"groupId"`
	Event   Event  `json:"event"`
}

type ListSubEventsResponse struct {
	GroupID         string     `json:"groupId"`
	EventID         string     `json:"eventId"`
	ResultsReturned int        `json:"resultsReturned"`
	SubEvents       []SubEvent `json:"subEvents"`
}

type GetSubEventResponse struct {
	GroupID  string   `json:"groupId"`
	EventID  string   `json:"eventId"`
	SubEvent SubEvent `json:"subEvent"`
}

type GetSurveyResponse struct {
	GroupID string `json:"groupId"`
	EventID string `json:"eventId"`
	Survey  Survey `json:"survey"`
}

type GetConferenceResponse struct {
	GroupID    string                `json:"groupId"`
	EventID    string                `json:"eventId"`
	Conference openapigen.Conference `json:"conference"`
}

func NewClient() *Client {
	base := os.Getenv("GDG_CONNPASS_URL")
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
		return &HTTPError{StatusCode: status, Message: strings.TrimSpace(string(body))}
	}
	if out == nil || len(body) == 0 {
		return nil
	}
	return json.Unmarshal(body, out)
}

func jsonBody(body any) (*bytes.Reader, error) {
	if body == nil {
		return bytes.NewReader(nil), nil
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(payload), nil
}

func (c *Client) request(ctx context.Context, token, method, pathname string, body any, contentType string, out any) error {
	var reader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(payload)
		if contentType == "" {
			contentType = "application/json"
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+pathname, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	res, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	payload, err := io.ReadAll(res.Body)
	if err != nil {
		return err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return &HTTPError{StatusCode: res.StatusCode, Message: strings.TrimSpace(string(payload))}
	}
	if out == nil || len(payload) == 0 {
		return nil
	}
	return json.Unmarshal(payload, out)
}

func (c *Client) StartEventAction(ctx context.Context, token, method, groupID, eventID, suffix string, body any) (Job, error) {
	var job Job
	err := c.request(ctx, token, method, path.Join("/api/groups", groupID, "events", eventID, suffix), body, "", &job)
	return job, err
}

func (c *Client) GetEventResource(ctx context.Context, token, groupID, eventID, suffix string, out any) error {
	return c.request(ctx, token, http.MethodGet, path.Join("/api/groups", groupID, "events", eventID, suffix), nil, "", out)
}

func (c *Client) UploadEventImage(ctx context.Context, token, groupID, eventID, filename string) (Job, error) {
	contents, err := os.ReadFile(filename)
	if err != nil {
		return Job{}, err
	}
	var payload bytes.Buffer
	writer := multipart.NewWriter(&payload)
	contentType := mime.TypeByExtension(path.Ext(filename))
	if contentType == "" {
		return Job{}, fmt.Errorf("unsupported image extension: %s", path.Ext(filename))
	}
	headers := make(textproto.MIMEHeader)
	headers.Set("Content-Disposition", fmt.Sprintf(`form-data; name="image"; filename="%s"`, path.Base(filename)))
	headers.Set("Content-Type", contentType)
	part, err := writer.CreatePart(headers)
	if err != nil {
		return Job{}, err
	}
	if _, err := part.Write(contents); err != nil {
		return Job{}, err
	}
	if err := writer.Close(); err != nil {
		return Job{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+path.Join("/api/groups", groupID, "events", eventID, "image"), &payload)
	if err != nil {
		return Job{}, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	res, err := c.HTTPClient.Do(req)
	if err != nil {
		return Job{}, err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	if err != nil {
		return Job{}, err
	}
	var job Job
	return job, decodeResponse(res.StatusCode, body, &job)
}

func (c *Client) GetJob(ctx context.Context, token, jobID string) (Job, error) {
	res, err := c.generatedClient().GetJobWithResponse(ctx, jobID, bearer(token))
	if err != nil {
		return Job{}, err
	}
	var job Job
	err = decodeResponse(res.StatusCode(), res.Body, &job)
	return job, err
}

func (c *Client) ListGroups(ctx context.Context, token string) ([]Group, error) {
	res, err := c.generatedClient().AdminListGroupsWithResponse(ctx, bearer(token))
	if err != nil {
		return nil, err
	}
	var payload struct {
		Groups []Group `json:"groups"`
	}
	if err := decodeResponse(res.StatusCode(), res.Body, &payload); err != nil {
		return nil, err
	}
	if payload.Groups == nil {
		return []Group{}, nil
	}
	return payload.Groups, nil
}

func (c *Client) UpsertGroup(ctx context.Context, token, groupID string, input UpsertGroupRequest) (Group, error) {
	res, err := c.generatedClient().AdminUpsertGroupWithResponse(ctx, groupID, input, bearer(token))
	if err != nil {
		return Group{}, err
	}
	var group Group
	err = decodeResponse(res.StatusCode(), res.Body, &group)
	return group, err
}

func (c *Client) Relogin(ctx context.Context, token string) (Job, error) {
	res, err := c.generatedClient().AdminReloginWithResponse(ctx, bearer(token))
	if err != nil {
		return Job{}, err
	}
	var job Job
	err = decodeResponse(res.StatusCode(), res.Body, &job)
	return job, err
}

func (c *Client) ListEvents(ctx context.Context, token, groupID string) (ListEventsResponse, error) {
	res, err := c.generatedClient().ListGroupEventsWithResponse(ctx, groupID, bearer(token))
	if err != nil {
		return ListEventsResponse{}, err
	}
	var out ListEventsResponse
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) CreateEvent(ctx context.Context, token, groupID string, body any) (Job, error) {
	reader, err := jsonBody(body)
	if err != nil {
		return Job{}, err
	}
	res, err := c.generatedClient().CreateGroupEventWithBodyWithResponse(
		ctx, groupID, "application/json", reader, bearer(token),
	)
	if err != nil {
		return Job{}, err
	}
	var job Job
	err = decodeResponse(res.StatusCode(), res.Body, &job)
	return job, err
}

func (c *Client) GetEvent(ctx context.Context, token, groupID, eventID string) (GetEventResponse, error) {
	res, err := c.generatedClient().GetGroupEventWithResponse(ctx, groupID, eventID, bearer(token))
	if err != nil {
		return GetEventResponse{}, err
	}
	var out GetEventResponse
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) UpdateEvent(ctx context.Context, token, groupID, eventID string, body any) (Job, error) {
	reader, err := jsonBody(body)
	if err != nil {
		return Job{}, err
	}
	res, err := c.generatedClient().UpdateGroupEventWithBodyWithResponse(
		ctx, groupID, eventID, "application/json", reader, bearer(token),
	)
	if err != nil {
		return Job{}, err
	}
	var job Job
	err = decodeResponse(res.StatusCode(), res.Body, &job)
	return job, err
}

func (c *Client) PublishEvent(ctx context.Context, token, groupID, eventID string, body any) (Job, error) {
	if body == nil {
		body = map[string]any{}
	}
	reader, err := jsonBody(body)
	if err != nil {
		return Job{}, err
	}
	res, err := c.generatedClient().PublishGroupEventWithBodyWithResponse(
		ctx, groupID, eventID, "application/json", reader, bearer(token),
	)
	if err != nil {
		return Job{}, err
	}
	var job Job
	err = decodeResponse(res.StatusCode(), res.Body, &job)
	return job, err
}

func (c *Client) ListSubEvents(ctx context.Context, token, groupID, eventID string) (ListSubEventsResponse, error) {
	res, err := c.generatedClient().ListGroupEventSubEventsWithResponse(ctx, groupID, eventID, bearer(token))
	if err != nil {
		return ListSubEventsResponse{}, err
	}
	var out ListSubEventsResponse
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) CreateSubEvent(ctx context.Context, token, groupID, eventID string, body any) (Job, error) {
	reader, err := jsonBody(body)
	if err != nil {
		return Job{}, err
	}
	res, err := c.generatedClient().CreateGroupEventSubEventWithBodyWithResponse(
		ctx, groupID, eventID, "application/json", reader, bearer(token),
	)
	if err != nil {
		return Job{}, err
	}
	var job Job
	err = decodeResponse(res.StatusCode(), res.Body, &job)
	return job, err
}

func (c *Client) GetSubEvent(ctx context.Context, token, groupID, eventID, subEventID string) (GetSubEventResponse, error) {
	res, err := c.generatedClient().GetGroupEventSubEventWithResponse(ctx, groupID, eventID, subEventID, bearer(token))
	if err != nil {
		return GetSubEventResponse{}, err
	}
	var out GetSubEventResponse
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) CancelSubEvent(ctx context.Context, token, groupID, eventID, subEventID string) (Job, error) {
	res, err := c.generatedClient().DeleteGroupEventSubEventWithResponse(
		ctx, groupID, eventID, subEventID, bearer(token),
	)
	if err != nil {
		return Job{}, err
	}
	var job Job
	err = decodeResponse(res.StatusCode(), res.Body, &job)
	return job, err
}

func (c *Client) GetSurvey(ctx context.Context, token, groupID, eventID string) (GetSurveyResponse, error) {
	res, err := c.generatedClient().GetGroupEventSurveyWithResponse(ctx, groupID, eventID, bearer(token))
	if err != nil {
		return GetSurveyResponse{}, err
	}
	var out GetSurveyResponse
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) UpsertSurvey(ctx context.Context, token, groupID, eventID string, body any) (Job, error) {
	reader, err := jsonBody(body)
	if err != nil {
		return Job{}, err
	}
	res, err := c.generatedClient().UpsertGroupEventSurveyWithBodyWithResponse(
		ctx, groupID, eventID, "application/json", reader, bearer(token),
	)
	if err != nil {
		return Job{}, err
	}
	var job Job
	err = decodeResponse(res.StatusCode(), res.Body, &job)
	return job, err
}

func (c *Client) GetConference(ctx context.Context, token, groupID, eventID string) (GetConferenceResponse, error) {
	res, err := c.generatedClient().GetGroupEventConferenceWithResponse(ctx, groupID, eventID, bearer(token))
	if err != nil {
		return GetConferenceResponse{}, err
	}
	var out GetConferenceResponse
	err = decodeResponse(res.StatusCode(), res.Body, &out)
	return out, err
}

func (c *Client) UpsertConference(ctx context.Context, token, groupID, eventID string, body any) (Job, error) {
	reader, err := jsonBody(body)
	if err != nil {
		return Job{}, err
	}
	res, err := c.generatedClient().UpsertGroupEventConferenceWithBodyWithResponse(
		ctx, groupID, eventID, "application/json", reader, bearer(token),
	)
	if err != nil {
		return Job{}, err
	}
	var job Job
	err = decodeResponse(res.StatusCode(), res.Body, &job)
	return job, err
}

// WaitJob polls the job until it reaches a terminal status. onPoll, when
// non-nil, is invoked once per non-terminal poll with the current job and the
// elapsed wait time, letting callers surface progress. There is no client-side
// timeout: waiting ends only on a terminal status or ctx cancellation.
func (c *Client) WaitJob(ctx context.Context, token, jobID string, pollEvery time.Duration, onPoll func(job Job, elapsed time.Duration)) (Job, error) {
	if pollEvery <= 0 {
		pollEvery = 2 * time.Second
	}
	start := time.Now()
	for {
		job, err := c.GetJob(ctx, token, jobID)
		if err != nil {
			return Job{}, err
		}
		if job.Status == openapigen.Succeeded || job.Status == openapigen.Failed {
			return job, nil
		}
		if onPoll != nil {
			onPoll(job, time.Since(start))
		}
		select {
		case <-ctx.Done():
			return job, ctx.Err()
		case <-time.After(pollEvery):
		}
	}
}

func JobFailed(job Job) error {
	if job.Status != openapigen.Failed {
		return nil
	}
	if job.Error != nil && *job.Error != "" {
		return fmt.Errorf("job failed: %s", *job.Error)
	}
	return fmt.Errorf("job failed")
}
