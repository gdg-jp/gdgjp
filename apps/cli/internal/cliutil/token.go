package cliutil

import (
	"context"
	"errors"
	"fmt"

	"github.com/gdg-jp/gdgjp/cli/internal/oauth"
	"github.com/gdg-jp/gdgjp/cli/internal/store"
)

type StatusError interface {
	error
	HTTPStatus() int
}

type NotLoggedInError struct{}

func (NotLoggedInError) Error() string { return "not logged in; run gdg login" }

var refreshAccessToken = oauth.Refresh

func SetRefreshForTesting(fn func(ctx context.Context, refreshToken string) (store.Credentials, error)) func() {
	previous := refreshAccessToken
	refreshAccessToken = fn
	return func() { refreshAccessToken = previous }
}

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
