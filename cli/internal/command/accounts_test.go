package command

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"

	accountsapi "github.com/gdg-jp/gdgjp/cli/internal/accounts"
	"github.com/spf13/cobra"
)

type fakeOIDCClientService struct {
	createInput accountsapi.CreateClientInput
	updateID    string
	updateInput accountsapi.UpdateClientInput
	deleteID    string
}

func (service *fakeOIDCClientService) Create(
	_ context.Context,
	input accountsapi.CreateClientInput,
) (json.RawMessage, error) {
	service.createInput = input
	return json.RawMessage(`{"client_id":"client-1","client_secret":"one-time-secret"}`), nil
}

func (service *fakeOIDCClientService) Update(
	_ context.Context,
	clientID string,
	input accountsapi.UpdateClientInput,
) (json.RawMessage, error) {
	service.updateID = clientID
	service.updateInput = input
	return json.RawMessage(`{"client_id":"client-1","client_name":"Renamed"}`), nil
}

func (service *fakeOIDCClientService) Delete(_ context.Context, clientID string) error {
	service.deleteID = clientID
	return nil
}

func TestCreateOIDCClientWritesSecretJSON(t *testing.T) {
	service := &fakeOIDCClientService{}
	root := newRootWithAccountsService(service)
	output := new(bytes.Buffer)
	root.SetOut(output)
	root.SetErr(new(bytes.Buffer))
	root.SetArgs([]string{
		"accounts", "oidc-client", "create", "--name", "Example",
		"--redirect-uri", "https://example.com/callback", "--scope", "email",
	})

	if err := root.Execute(); err != nil {
		t.Fatal(err)
	}
	if got := service.createInput.RedirectURIs; len(got) != 1 || got[0] != "https://example.com/callback" {
		t.Fatalf("redirect URIs = %#v", got)
	}
	if got := output.String(); !strings.Contains(got, `"client_secret":"one-time-secret"`) {
		t.Fatalf("output = %s", got)
	}
}

func TestUpdateOIDCClientOnlySendsChangedFields(t *testing.T) {
	service := &fakeOIDCClientService{}
	root := newRootWithAccountsService(service)
	root.SetOut(new(bytes.Buffer))
	root.SetErr(new(bytes.Buffer))
	root.SetArgs([]string{"accounts", "oidc-client", "update", "client-1", "--clear-app-url"})

	if err := root.Execute(); err != nil {
		t.Fatal(err)
	}
	if service.updateID != "client-1" || service.updateInput.AppURL == nil || *service.updateInput.AppURL != "" {
		t.Fatalf("update = %#v", service.updateInput)
	}
	if service.updateInput.Name != nil || service.updateInput.RedirectURIs != nil {
		t.Fatalf("unexpected fields in update: %#v", service.updateInput)
	}
}

func TestDeleteOIDCClientRequiresYes(t *testing.T) {
	service := &fakeOIDCClientService{}
	root := newRootWithAccountsService(service)
	root.SetOut(new(bytes.Buffer))
	root.SetErr(new(bytes.Buffer))
	root.SetArgs([]string{"accounts", "oidc-client", "delete", "client-1"})

	err := root.Execute()
	if err == nil || !strings.Contains(err.Error(), "without --yes") {
		t.Fatalf("error = %v", err)
	}
	if service.deleteID != "" {
		t.Fatalf("delete called for %q", service.deleteID)
	}
}

func TestDeleteOIDCClientWritesJSON(t *testing.T) {
	service := &fakeOIDCClientService{}
	root := newRootWithAccountsService(service)
	output := new(bytes.Buffer)
	root.SetOut(output)
	root.SetErr(new(bytes.Buffer))
	root.SetArgs([]string{"accounts", "oidc-client", "delete", "client-1", "--yes"})

	if err := root.Execute(); err != nil {
		t.Fatal(err)
	}
	if service.deleteID != "client-1" || output.String() != "{\"client_id\":\"client-1\",\"deleted\":true}\n" {
		t.Fatalf("delete ID = %q, output = %s", service.deleteID, output.String())
	}
}

func newRootWithAccountsService(service oidcClientService) *cobra.Command {
	root := &cobra.Command{Use: "gdg"}
	root.AddCommand(newAccountsCommandWithService(service))
	return root
}
