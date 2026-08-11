package connpass

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const defaultBaseURL = "https://connpass.gdgs.jp"

type Client struct {
	BaseURL    string
	HTTPClient *http.Client
}

type HTTPError struct {
	StatusCode int
	Message    string
}

func (e *HTTPError) Error() string {
	return fmt.Sprintf("connpass request failed (%d): %s", e.StatusCode, e.Message)
}

func NewClient() *Client {
	base := os.Getenv("GDG_CONNPASS_URL")
	if base == "" {
		base = defaultBaseURL
	}
	return &Client{BaseURL: strings.TrimRight(base, "/"), HTTPClient: http.DefaultClient}
}

type Job struct {
	ID         string          `json:"id"`
	Type       string          `json:"type"`
	Status     string          `json:"status"`
	GroupID    string          `json:"groupId"`
	EventID    *string         `json:"eventId"`
	Request    json.RawMessage `json:"request"`
	Result     json.RawMessage `json:"result"`
	Error      *string         `json:"error"`
	CreatedBy  string          `json:"createdBy"`
	CreatedAt  string          `json:"createdAt"`
	UpdatedAt  string          `json:"updatedAt"`
	StartedAt  *string         `json:"startedAt"`
	FinishedAt *string         `json:"finishedAt"`
}

type CreateEventInput struct {
	Title       string `json:"title"`
	Subtitle    string `json:"subtitle,omitempty"`
	Description string `json:"description,omitempty"`
	StartAt     string `json:"startAt,omitempty"`
	EndAt       string `json:"endAt,omitempty"`
	Place       string `json:"place,omitempty"`
	Address     string `json:"address,omitempty"`
	Capacity    *int   `json:"capacity,omitempty"`
}

func (c *Client) doJSON(ctx context.Context, method, path, token string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(payload)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		return err
	}
	if res.StatusCode >= 400 {
		return &HTTPError{StatusCode: res.StatusCode, Message: string(data)}
	}
	if out == nil || res.StatusCode == http.StatusNoContent {
		return nil
	}
	return json.Unmarshal(data, out)
}

func (c *Client) GetJob(ctx context.Context, token, jobID string) (Job, error) {
	var job Job
	err := c.doJSON(ctx, http.MethodGet, "/api/jobs/"+url.PathEscape(jobID), token, nil, &job)
	return job, err
}

func (c *Client) CreateEvent(ctx context.Context, token, groupID string, input CreateEventInput) (Job, error) {
	var job Job
	err := c.doJSON(ctx, http.MethodPost, "/api/groups/"+url.PathEscape(groupID)+"/events", token, input, &job)
	return job, err
}

func (c *Client) PublishEvent(ctx context.Context, token, groupID, eventID string) (Job, error) {
	var job Job
	err := c.doJSON(ctx, http.MethodPost, "/api/groups/"+url.PathEscape(groupID)+"/events/"+url.PathEscape(eventID)+"/publish", token, map[string]any{}, &job)
	return job, err
}

func (c *Client) WaitJob(ctx context.Context, token, jobID string, pollEvery time.Duration) (Job, error) {
	if pollEvery <= 0 {
		pollEvery = 2 * time.Second
	}
	for {
		job, err := c.GetJob(ctx, token, jobID)
		if err != nil {
			return Job{}, err
		}
		if job.Status == "succeeded" || job.Status == "failed" {
			return job, nil
		}
		select {
		case <-ctx.Done():
			return job, ctx.Err()
		case <-time.After(pollEvery):
		}
	}
}
