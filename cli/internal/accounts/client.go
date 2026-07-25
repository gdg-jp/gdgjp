package accounts

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

const DefaultBaseURL = "https://accounts.gdgs.jp"

type Client struct {
	baseURL    string
	httpClient *http.Client
}

type HTTPError struct {
	StatusCode int
	Status     string
	Message    string
}

func (err *HTTPError) Error() string {
	return fmt.Sprintf("OIDC client request failed: %s: %s", err.Status, err.Message)
}

func NewClient(baseURL string, httpClient *http.Client) *Client {
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &Client{baseURL: strings.TrimRight(baseURL, "/"), httpClient: httpClient}
}

type CreateClientInput struct {
	Name                   string
	AppURL                 string
	RedirectURIs           []string
	PostLogoutRedirectURIs []string
	Scopes                 []string
}

type UpdateClientInput struct {
	Name                   *string
	AppURL                 *string
	RedirectURIs           []string
	PostLogoutRedirectURIs []string
	Scopes                 []string
}

func (c *Client) CreateOIDCClient(
	ctx context.Context,
	accessToken string,
	input CreateClientInput,
) (json.RawMessage, error) {
	body := map[string]any{
		"client_name":   input.Name,
		"redirect_uris": input.RedirectURIs,
	}
	if input.AppURL != "" {
		body["client_uri"] = input.AppURL
	}
	if len(input.PostLogoutRedirectURIs) > 0 {
		body["post_logout_redirect_uris"] = input.PostLogoutRedirectURIs
	}
	if len(input.Scopes) > 0 {
		body["scope"] = strings.Join(input.Scopes, " ")
	}
	return c.post(ctx, accessToken, "/api/auth/oauth2/create-client", body)
}

func (c *Client) UpdateOIDCClient(
	ctx context.Context,
	accessToken string,
	clientID string,
	input UpdateClientInput,
) (json.RawMessage, error) {
	update := map[string]any{}
	if input.Name != nil {
		update["client_name"] = *input.Name
	}
	if input.AppURL != nil {
		update["client_uri"] = *input.AppURL
	}
	if input.RedirectURIs != nil {
		update["redirect_uris"] = input.RedirectURIs
	}
	if input.PostLogoutRedirectURIs != nil {
		update["post_logout_redirect_uris"] = input.PostLogoutRedirectURIs
	}
	if input.Scopes != nil {
		update["scope"] = strings.Join(input.Scopes, " ")
	}
	return c.post(ctx, accessToken, "/api/auth/oauth2/update-client", map[string]any{
		"client_id": clientID,
		"update":    update,
	})
}

func (c *Client) DeleteOIDCClient(
	ctx context.Context,
	accessToken string,
	clientID string,
) error {
	_, err := c.post(ctx, accessToken, "/api/auth/oauth2/delete-client", map[string]any{
		"client_id": clientID,
	})
	return err
}

func (c *Client) post(
	ctx context.Context,
	accessToken string,
	path string,
	body any,
) (json.RawMessage, error) {
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		c.baseURL+path,
		bytes.NewReader(encoded),
	)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+accessToken)
	request.Header.Set("Content-Type", "application/json")
	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("contact GDG Japan Accounts: %w", err)
	}
	defer response.Body.Close()
	contents, err := io.ReadAll(io.LimitReader(response.Body, 16*1024))
	if err != nil {
		return nil, err
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, &HTTPError{
			StatusCode: response.StatusCode,
			Status:     response.Status,
			Message:    errorMessage(contents),
		}
	}
	return json.RawMessage(contents), nil
}

func errorMessage(contents []byte) string {
	var response struct {
		ErrorDescription string `json:"error_description"`
		Error            string `json:"error"`
	}
	if json.Unmarshal(contents, &response) == nil {
		if response.ErrorDescription != "" {
			return response.ErrorDescription
		}
		if response.Error != "" {
			return response.Error
		}
	}
	return strings.TrimSpace(string(contents))
}
