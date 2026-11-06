package runner

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ErrLeaseLost means the server no longer considers this runner the job's owner.
var ErrLeaseLost = errors.New("job lease lost")

// API is the /api/runner/* client. Every call carries RUNNER_TOKEN and the runner's host.
type API struct {
	BaseURL    string
	Token      string
	Host       string
	HTTPClient *http.Client
}

type Job struct {
	ID         string          `json:"id"`
	Type       string          `json:"type"`
	SpaceID    string          `json:"spaceId"`
	Payload    json.RawMessage `json:"payload"`
	Attempts   int             `json:"attempts"`
	DeadlineAt *int64          `json:"deadlineAt"`
}

type Space struct {
	ID   string `json:"id"`
	Slug string `json:"slug"`
	Name string `json:"name"`
	Lang string `json:"lang"`
}

type Source struct {
	ID         string  `json:"id"`
	Kind       string  `json:"kind"`
	Title      string  `json:"title"`
	Visibility string  `json:"visibility"`
	ChapterID  *string `json:"chapterId"`
	URL        string  `json:"url"`
}

type Document struct {
	ID       string `json:"id"`
	SourceID string `json:"sourceId"`
	Path     string `json:"path"`
	Title    string `json:"title"`
	Bytes    *int64 `json:"bytes"`
	IsNew    bool   `json:"isNew"`
}

type Request struct {
	PageSlug        string `json:"pageSlug"`
	Text            string `json:"text"`
	RequestedBy     string `json:"requestedBy"`
	RequestedByName string `json:"requestedByName"`
}

type JobContext struct {
	Space     *Space     `json:"space"`
	Sources   []Source   `json:"sources"`
	Documents []Document `json:"documents"`
	Requests  []Request  `json:"requests"`
}

type RequestOutcome struct {
	Index   int    `json:"index"`
	Applied bool   `json:"applied"`
	Note    string `json:"note,omitempty"`
}

type ReviewFlag struct {
	Kind    string `json:"kind"`
	Payload any    `json:"payload,omitempty"`
}

type Result struct {
	Status                string           `json:"status"`
	Result                any              `json:"result,omitempty"`
	Error                 string           `json:"error,omitempty"`
	IntegratedDocumentIDs []string         `json:"integratedDocumentIds,omitempty"`
	RequestOutcomes       []RequestOutcome `json:"requestOutcomes,omitempty"`
	Retry                 bool             `json:"retry,omitempty"`
	ReviewFlag            *ReviewFlag      `json:"reviewFlag,omitempty"`
}

type Page struct {
	ID        string `json:"id"`
	Slug      string `json:"slug"`
	TitleJa   string `json:"titleJa"`
	ContentJa string `json:"contentJa"`
}

type APIError struct {
	Status int
	Body   string
}

func (e *APIError) Error() string { return fmt.Sprintf("runner API %d: %s", e.Status, e.Body) }

func (a *API) do(ctx context.Context, method, path string, body any, out any) (int, error) {
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return 0, err
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(a.BaseURL, "/")+path, reader)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Authorization", "Bearer "+a.Token)
	req.Header.Set("X-Runner-Host", a.Host)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	client := a.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 60 * time.Second}
	}
	res, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNoContent {
		return res.StatusCode, nil
	}
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return res.StatusCode, &APIError{Status: res.StatusCode, Body: strings.TrimSpace(string(raw))}
	}
	if out != nil {
		if err := json.Unmarshal(raw, out); err != nil {
			return res.StatusCode, fmt.Errorf("decode %s: %w", path, err)
		}
	}
	return res.StatusCode, nil
}

func (a *API) Heartbeat(ctx context.Context, version, backend, runningJobID string) error {
	body := map[string]any{"version": version, "backend": backend, "runningJobId": nil}
	if runningJobID != "" {
		body["runningJobId"] = runningJobID
	}
	_, err := a.do(ctx, http.MethodPost, "/api/runner/heartbeat", body, nil)
	return err
}

// Next leases one job of the given types, long-polling up to wait. nil means none queued.
func (a *API) Next(ctx context.Context, types []string, wait time.Duration) (*Job, error) {
	path := "/api/runner/jobs/next?types=" + url.QueryEscape(strings.Join(types, ",")) +
		fmt.Sprintf("&wait=%d", int(wait.Seconds()))
	var job Job
	status, err := a.do(ctx, http.MethodGet, path, nil, &job)
	if err != nil || status == http.StatusNoContent {
		return nil, err
	}
	return &job, nil
}

func (a *API) Context(ctx context.Context, jobID string) (JobContext, error) {
	var out JobContext
	_, err := a.do(ctx, http.MethodGet, "/api/runner/jobs/"+url.PathEscape(jobID)+"/context", nil, &out)
	if err == nil && out.Space == nil {
		err = fmt.Errorf("job %s has no space", jobID)
	}
	return out, err
}

func leaseErr(err error) error {
	var apiErr *APIError
	if errors.As(err, &apiErr) && apiErr.Status == http.StatusConflict {
		return ErrLeaseLost
	}
	return err
}

func (a *API) ExtendLease(ctx context.Context, jobID string) error {
	_, err := a.do(ctx, http.MethodPost, "/api/runner/jobs/"+url.PathEscape(jobID)+"/heartbeat", map[string]any{}, nil)
	return leaseErr(err)
}

func (a *API) Complete(ctx context.Context, jobID string, result Result) error {
	_, err := a.do(ctx, http.MethodPost, "/api/runner/jobs/"+url.PathEscape(jobID)+"/result", result, nil)
	return leaseErr(err)
}

func (a *API) Page(ctx context.Context, pageID string) (Page, error) {
	var out Page
	_, err := a.do(ctx, http.MethodGet, "/api/runner/pages/"+url.PathEscape(pageID), nil, &out)
	return out, err
}

func (a *API) PostTranslation(ctx context.Context, pageID, titleEn, contentEn, sourceHash string) error {
	body := map[string]string{"titleEn": titleEn, "contentEn": contentEn, "sourceHash": sourceHash}
	_, err := a.do(ctx, http.MethodPost, "/api/runner/pages/"+url.PathEscape(pageID)+"/translation", body, nil)
	return err
}
