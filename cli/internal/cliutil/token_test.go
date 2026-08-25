package cliutil

import (
	"context"
	"errors"
	"testing"

	"github.com/gdg-jp/gdgjp/cli/internal/store"
)

type fakeStatusError struct {
	status int
}

func (e *fakeStatusError) Error() string   { return "fake status error" }
func (e *fakeStatusError) HTTPStatus() int { return e.status }

type fakeCredentialStore struct {
	credentials store.Credentials
	loadErr     error
	saved       *store.Credentials
	saveErr     error
}

func (s *fakeCredentialStore) Load() (store.Credentials, error) {
	return s.credentials, s.loadErr
}

func (s *fakeCredentialStore) Save(credentials store.Credentials) error {
	s.saved = &credentials
	return s.saveErr
}

func (s *fakeCredentialStore) Delete() error { return nil }

func TestWithTokenSuccess(t *testing.T) {
	credentials := &fakeCredentialStore{
		credentials: store.Credentials{AccessToken: "access", RefreshToken: "refresh"},
	}
	calls := 0
	result, err := WithToken(context.Background(), credentials, func(token string) (string, error) {
		calls++
		if token != "access" {
			t.Fatalf("token = %q", token)
		}
		return "ok", nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if result != "ok" {
		t.Fatalf("result = %q", result)
	}
	if calls != 1 {
		t.Fatalf("calls = %d, want 1", calls)
	}
}

func TestWithTokenNotLoggedIn(t *testing.T) {
	credentials := &fakeCredentialStore{loadErr: store.ErrNotFound}
	_, err := WithToken(context.Background(), credentials, func(string) (string, error) {
		t.Fatal("fn should not be called when not logged in")
		return "", nil
	})
	if err == nil || err.Error() != "not logged in; run gdg login" {
		t.Fatalf("error = %v", err)
	}
	var notLoggedIn NotLoggedInError
	if !errors.As(err, &notLoggedIn) {
		t.Fatalf("error type = %T, want NotLoggedInError", err)
	}
}

func TestWithTokenLoadErrorPassthrough(t *testing.T) {
	loadErr := errors.New("keyring unavailable")
	credentials := &fakeCredentialStore{loadErr: loadErr}
	_, err := WithToken(context.Background(), credentials, func(string) (string, error) {
		t.Fatal("fn should not be called on a load error")
		return "", nil
	})
	if !errors.Is(err, loadErr) {
		t.Fatalf("error = %v, want %v", err, loadErr)
	}
}

func TestWithTokenNonStatusErrorPassthrough(t *testing.T) {
	credentials := &fakeCredentialStore{
		credentials: store.Credentials{AccessToken: "access", RefreshToken: "refresh"},
	}
	fnErr := errors.New("boom")
	calls := 0
	_, err := WithToken(context.Background(), credentials, func(string) (string, error) {
		calls++
		return "", fnErr
	})
	if !errors.Is(err, fnErr) {
		t.Fatalf("error = %v, want %v", err, fnErr)
	}
	if calls != 1 {
		t.Fatalf("calls = %d, want 1 (no retry on a non-status error)", calls)
	}
}

func TestWithTokenNon401StatusErrorPassthrough(t *testing.T) {
	credentials := &fakeCredentialStore{
		credentials: store.Credentials{AccessToken: "access", RefreshToken: "refresh"},
	}
	fnErr := &fakeStatusError{status: 500}
	calls := 0
	_, err := WithToken(context.Background(), credentials, func(string) (string, error) {
		calls++
		return "", fnErr
	})
	if !errors.Is(err, fnErr) {
		t.Fatalf("error = %v, want %v", err, fnErr)
	}
	if calls != 1 {
		t.Fatalf("calls = %d, want 1 (no retry on a non-401 status)", calls)
	}
}

// stubRefresh swaps the package's refresh seam for the duration of a test, so
// tests never make a real network call to oauth.Refresh.
func stubRefresh(t *testing.T, fn func(ctx context.Context, refreshToken string) (store.Credentials, error)) {
	t.Helper()
	previous := refreshAccessToken
	refreshAccessToken = fn
	t.Cleanup(func() { refreshAccessToken = previous })
}

func TestWithTokenRefreshesOnceOn401(t *testing.T) {
	refreshCalls := 0
	stubRefresh(t, func(_ context.Context, refreshToken string) (store.Credentials, error) {
		refreshCalls++
		if refreshToken != "refresh" {
			t.Fatalf("refresh token = %q, want %q", refreshToken, "refresh")
		}
		return store.Credentials{AccessToken: "new-access", RefreshToken: "new-refresh"}, nil
	})

	credentials := &fakeCredentialStore{
		credentials: store.Credentials{AccessToken: "old-access", RefreshToken: "refresh"},
	}

	var tokensSeen []string
	result, err := WithToken(context.Background(), credentials, func(token string) (string, error) {
		tokensSeen = append(tokensSeen, token)
		if token == "old-access" {
			return "", &fakeStatusError{status: 401}
		}
		return "ok:" + token, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if result != "ok:new-access" {
		t.Fatalf("result = %q, want %q", result, "ok:new-access")
	}
	if len(tokensSeen) != 2 || tokensSeen[0] != "old-access" || tokensSeen[1] != "new-access" {
		t.Fatalf("tokens seen = %#v, want exactly [old-access new-access] (one retry)", tokensSeen)
	}
	if refreshCalls != 1 {
		t.Fatalf("refresh calls = %d, want 1", refreshCalls)
	}
	if credentials.saved == nil || *credentials.saved != (store.Credentials{
		AccessToken:  "new-access",
		RefreshToken: "new-refresh",
	}) {
		t.Fatalf("saved credentials = %#v, want the refreshed credentials", credentials.saved)
	}
}

func TestWithTokenRetriesExactlyOnceOn401(t *testing.T) {
	stubRefresh(t, func(context.Context, string) (store.Credentials, error) {
		return store.Credentials{AccessToken: "new-access", RefreshToken: "new-refresh"}, nil
	})

	credentials := &fakeCredentialStore{
		credentials: store.Credentials{AccessToken: "old-access", RefreshToken: "refresh"},
	}
	calls := 0
	persistentErr := &fakeStatusError{status: 401}
	_, err := WithToken(context.Background(), credentials, func(string) (string, error) {
		calls++
		return "", persistentErr
	})
	if !errors.Is(err, persistentErr) {
		t.Fatalf("error = %v, want the second 401 returned as-is", err)
	}
	if calls != 2 {
		t.Fatalf("calls = %d, want exactly 2 (initial attempt plus one retry)", calls)
	}
}

func TestWithTokenRefreshFailureIsWrapped(t *testing.T) {
	refreshErr := errors.New("refresh rejected")
	stubRefresh(t, func(context.Context, string) (store.Credentials, error) {
		return store.Credentials{}, refreshErr
	})

	credentials := &fakeCredentialStore{
		credentials: store.Credentials{AccessToken: "old-access", RefreshToken: "refresh"},
	}
	_, err := WithToken(context.Background(), credentials, func(string) (string, error) {
		return "", &fakeStatusError{status: 401}
	})
	if !errors.Is(err, refreshErr) {
		t.Fatalf("error = %v, want it to wrap %v", err, refreshErr)
	}
}
