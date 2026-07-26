package accounts

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"strings"
)

const DefaultBaseURL = "https://accounts.gdgs.jp"

type AccountsClient struct {
	client *ClientWithResponses
}

type HTTPError struct {
	StatusCode int
	Status     string
	Message    string
}

func (err *HTTPError) Error() string {
	return fmt.Sprintf("OIDC client request failed: %s: %s", err.Status, err.Message)
}

func NewAccountsClient(baseURL string, httpClient *http.Client) *AccountsClient {
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	generated, err := NewClientWithResponses(strings.TrimRight(baseURL, "/"), WithHTTPClient(httpClient))
	if err != nil {
		panic(err)
	}
	return &AccountsClient{client: generated}
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
