package accounts

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"reflect"
	"strings"
)

const DefaultBaseURL = "https://accounts.gdgs.jp"

type AccountsClient struct {
	baseURL    string
	httpClient *http.Client
	client     *ClientWithResponses
}

type HTTPError struct {
	StatusCode int
	Status     string
	Message    string
}

func (err *HTTPError) Error() string {
	return fmt.Sprintf("GDG Japan Accounts request failed: %s: %s", err.Status, err.Message)
}

func (err *HTTPError) HTTPStatus() int { return err.StatusCode }

func NewAccountsClient(baseURL string, httpClient *http.Client) *AccountsClient {
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	trimmed := strings.TrimRight(baseURL, "/")
	generated, err := NewClientWithResponses(trimmed, WithHTTPClient(httpClient))
	if err != nil {
		panic(err)
	}
	return &AccountsClient{baseURL: trimmed, httpClient: httpClient, client: generated}
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

func (c *AccountsClient) CreateOIDCClient(
	ctx context.Context,
	accessToken string,
	input CreateClientInput,
) (json.RawMessage, error) {
	name := input.Name
	redirectURIs := input.RedirectURIs
	body := OAuthClientInput{ClientName: &name, RedirectUris: &redirectURIs}
	if input.AppURL != "" {
		body.ClientUri = &input.AppURL
	}
	if len(input.PostLogoutRedirectURIs) > 0 {
		body.PostLogoutRedirectUris = &input.PostLogoutRedirectURIs
	}
	if len(input.Scopes) > 0 {
		scope := strings.Join(input.Scopes, " ")
		body.Scope = &scope
	}
	response, err := c.client.CreateOAuthClientWithResponse(ctx, body, bearer(accessToken))
	return rawResponse(response, err)
}

func (c *AccountsClient) UpdateOIDCClient(
	ctx context.Context,
	accessToken string,
	clientID string,
	input UpdateClientInput,
) (json.RawMessage, error) {
	update := OAuthClientInput{}
	if input.Name != nil {
		update.ClientName = input.Name
	}
	if input.AppURL != nil {
		update.ClientUri = input.AppURL
	}
	if input.RedirectURIs != nil {
		update.RedirectUris = &input.RedirectURIs
	}
	if input.PostLogoutRedirectURIs != nil {
		update.PostLogoutRedirectUris = &input.PostLogoutRedirectURIs
	}
	if input.Scopes != nil {
		scope := strings.Join(input.Scopes, " ")
		update.Scope = &scope
	}
	response, err := c.client.UpdateOAuthClientWithResponse(ctx, OAuthClientUpdate{ClientId: clientID, Update: update}, bearer(accessToken))
	return rawResponse(response, err)
}

func (c *AccountsClient) DeleteOIDCClient(
	ctx context.Context,
	accessToken string,
	clientID string,
) error {
	response, err := c.client.DeleteOAuthClientWithResponse(ctx, DeleteOAuthClientJSONRequestBody{ClientId: clientID}, bearer(accessToken))
	_, err = rawResponse(response, err)
	return err
}

type WorkspaceTokenResult struct {
	AccessToken string
	ExpiresIn   int
}

// VendWorkspaceToken calls the privileged token-vending endpoint added in
// docs/agents-local-gws/01-accounts-workspace-link.md. It is not part of the
// generated OpenAPI client: that endpoint is a narrowly-gated internal API for
// the gdgagent-svc identity, not a public OIDC client-management operation.
// accessToken must be gdgagent-svc's own gdg login access token; userID is the
// target GDG account's sub whose stored Workspace refresh token gets exchanged.
func (c *AccountsClient) VendWorkspaceToken(
	ctx context.Context,
	accessToken string,
	userID string,
) (WorkspaceTokenResult, error) {
	body, err := json.Marshal(struct {
		UserID string `json:"userId"`
	}{UserID: userID})
	if err != nil {
		return WorkspaceTokenResult{}, err
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		c.baseURL+"/api/agents/google-workspace-token",
		bytes.NewReader(body),
	)
	if err != nil {
		return WorkspaceTokenResult{}, err
	}
	request.Header.Set("Authorization", "Bearer "+accessToken)
	request.Header.Set("Content-Type", "application/json")

	response, err := c.httpClient.Do(request)
	if err != nil {
		return WorkspaceTokenResult{}, fmt.Errorf("contact GDG Japan Accounts: %w", err)
	}
	defer response.Body.Close()
	contents, err := io.ReadAll(response.Body)
	if err != nil {
		return WorkspaceTokenResult{}, fmt.Errorf("read GDG Japan Accounts response: %w", err)
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return WorkspaceTokenResult{}, &HTTPError{
			StatusCode: response.StatusCode,
			Status:     response.Status,
			Message:    errorMessage(contents),
		}
	}
	var parsed struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(contents, &parsed); err != nil {
		return WorkspaceTokenResult{}, fmt.Errorf("parse Google Workspace token response: %w", err)
	}
	if parsed.AccessToken == "" || parsed.ExpiresIn <= 0 {
		return WorkspaceTokenResult{}, fmt.Errorf(
			"GDG Japan Accounts returned a malformed token response: %s",
			strings.TrimSpace(string(contents)),
		)
	}
	return WorkspaceTokenResult{AccessToken: parsed.AccessToken, ExpiresIn: parsed.ExpiresIn}, nil
}

func bearer(token string) RequestEditorFn {
	return func(_ context.Context, request *http.Request) error {
		request.Header.Set("Authorization", "Bearer "+token)
		return nil
	}
}

type generatedResponse interface {
	Status() string
	StatusCode() int
}

func rawResponse[T generatedResponse](response T, err error) (json.RawMessage, error) {
	if err != nil {
		return nil, fmt.Errorf("contact GDG Japan Accounts: %w", err)
	}
	contents := reflect.ValueOf(response).Elem().FieldByName("Body").Bytes()
	if response.StatusCode() < http.StatusOK || response.StatusCode() >= http.StatusMultipleChoices {
		return nil, &HTTPError{StatusCode: response.StatusCode(), Status: response.Status(), Message: errorMessage(contents)}
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
