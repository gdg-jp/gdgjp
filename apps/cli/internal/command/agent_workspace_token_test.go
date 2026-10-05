package command

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	accountsapi "github.com/gdg-jp/gdgjp/cli/internal/accounts"
	"github.com/gdg-jp/gdgjp/cli/internal/store"
	"github.com/spf13/cobra"
)

type notLoggedInStore struct{}

func (notLoggedInStore) Save(store.Credentials) error { return nil }
func (notLoggedInStore) Load() (store.Credentials, error) {
	return store.Credentials{}, store.ErrNotFound
}
func (notLoggedInStore) Delete() error { return nil }

type fakeWorkspaceTokenService struct {
	sub    string
	result accountsapi.WorkspaceTokenResult
	err    error
}

func (service *fakeWorkspaceTokenService) VendWorkspaceToken(
	_ context.Context,
	sub string,
) (accountsapi.WorkspaceTokenResult, error) {
	service.sub = sub
	return service.result, service.err
}

func newRootWithAgentService(service workspaceTokenService) *cobra.Command {
	root := &cobra.Command{Use: "gdg"}
	root.AddCommand(newAgentCommandWithService(service))
	return root
}

func TestWorkspaceTokenCommandRequiresSub(t *testing.T) {
	service := &fakeWorkspaceTokenService{}
	root := newRootWithAgentService(service)
	root.SetOut(new(bytes.Buffer))
	root.SetErr(new(bytes.Buffer))
	root.SetArgs([]string{"agent", "workspace-token"})

	if err := root.Execute(); err == nil {
		t.Fatal("expected an error when --sub is missing")
	}
	if service.sub != "" {
		t.Fatalf("service called with sub = %q", service.sub)
	}
}

func TestWorkspaceTokenCommandWritesAccessTokenJSON(t *testing.T) {
	service := &fakeWorkspaceTokenService{
		result: accountsapi.WorkspaceTokenResult{AccessToken: "short-lived-token", ExpiresIn: 3599},
	}
	root := newRootWithAgentService(service)
	output := new(bytes.Buffer)
	root.SetOut(output)
	root.SetErr(new(bytes.Buffer))
	root.SetArgs([]string{"agent", "workspace-token", "--sub", "target-sub"})

	if err := root.Execute(); err != nil {
		t.Fatal(err)
	}
	if service.sub != "target-sub" {
		t.Fatalf("sub = %q", service.sub)
	}
	if got, want := output.String(), `{"access_token":"short-lived-token","expires_in":3599}`+"\n"; got != want {
		t.Fatalf("output = %s, want %s", got, want)
	}
}

func TestWorkspaceTokenCommandPropagatesServiceError(t *testing.T) {
	service := &fakeWorkspaceTokenService{err: errors.New("not_connected")}
	root := newRootWithAgentService(service)
	root.SetOut(new(bytes.Buffer))
	root.SetErr(new(bytes.Buffer))
	root.SetArgs([]string{"agent", "workspace-token", "--sub", "target-sub"})

	err := root.Execute()
	if err == nil || !strings.Contains(err.Error(), "not_connected") {
		t.Fatalf("error = %v", err)
	}
}

func TestAgentServiceRequiresLogin(t *testing.T) {
	service := &agentService{credentials: notLoggedInStore{}}
	_, err := service.VendWorkspaceToken(context.Background(), "target-sub")
	if err == nil || !strings.Contains(err.Error(), "not logged in") {
		t.Fatalf("error = %v", err)
	}
}
