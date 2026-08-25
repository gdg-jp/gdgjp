// Package cliutil holds helpers shared by every gdg CLI command package: the
// load-credentials/call/refresh-on-401/retry-once flow, and the canonical
// indented JSON writer.
package cliutil

import (
	"context"
	"errors"
	"fmt"

	"github.com/gdg-jp/gdgjp/cli/internal/oauth"
	"github.com/gdg-jp/gdgjp/cli/internal/store"
)

// StatusError is implemented by each package-local HTTPError type via an
// HTTPStatus method (a new method name, since a struct can't have both a
// field and a method literally named StatusCode).
type StatusError interface {
	error
	HTTPStatus() int
}

// NotLoggedInError is returned by WithToken when no credentials are stored.
type NotLoggedInError struct{}

func (NotLoggedInError) Error() string { return "not logged in; run gdg login" }

// refreshAccessToken is a var, not oauth.Refresh called directly, so tests in
// this package can stub the network call (mirrors oauth's own issuer seam).
var refreshAccessToken = oauth.Refresh

// WithToken loads stored credentials and calls fn with the access token. If
// fn fails with a 401 (per StatusError.HTTPStatus), it refreshes the access
// token via oauth.Refresh, saves the refreshed credentials, and calls fn
// exactly once more with the new access token.
func WithToken[T any](
	ctx context.Context,
	credentials store.CredentialStore,
	fn func(accessToken string) (T, error),
) (T, error) {
	var zero T
	credential, err := credentials.Load()
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return zero, NotLoggedInError{}
		}
		return zero, err
	}
	result, err := fn(credential.AccessToken)
	if err == nil {
		return result, nil
	}
	var statusErr StatusError
	if !errors.As(err, &statusErr) || statusErr.HTTPStatus() != 401 {
		return zero, err
	}
	fresh, refreshErr := refreshAccessToken(ctx, credential.RefreshToken)
	if refreshErr != nil {
		return zero, fmt.Errorf("refresh GDG Japan login: %w", refreshErr)
	}
	if saveErr := credentials.Save(fresh); saveErr != nil {
		return zero, saveErr
	}
	return fn(fresh.AccessToken)
}
