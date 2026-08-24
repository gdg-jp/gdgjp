package command

import (
	"context"
	"errors"
	"fmt"

	accountsapi "github.com/gdg-jp/gdgjp/cli/internal/accounts"
	"github.com/gdg-jp/gdgjp/cli/internal/oauth"
	"github.com/gdg-jp/gdgjp/cli/internal/store"
	"github.com/spf13/cobra"
)

type workspaceTokenService interface {
	VendWorkspaceToken(ctx context.Context, sub string) (accountsapi.WorkspaceTokenResult, error)
}

type agentService struct {
	credentials store.CredentialStore
	client      *accountsapi.AccountsClient
}

func newAgentCommand(credentials store.CredentialStore) *cobra.Command {
	return newAgentCommandWithService(&agentService{
		credentials: credentials,
		client:      accountsapi.NewAccountsClient(accountsapi.DefaultBaseURL, nil),
	})
}

func newAgentCommandWithService(service workspaceTokenService) *cobra.Command {
	agent := &cobra.Command{
		Use:   "agent",
		Short: "Privileged operations for the gdgagent-svc identity",
	}
	agent.AddCommand(newWorkspaceTokenCommand(service))
	return agent
}

func newWorkspaceTokenCommand(service workspaceTokenService) *cobra.Command {
	var sub string
	command := &cobra.Command{
		Use:   "workspace-token",
		Short: "Vend a short-lived Google Workspace access token for a linked GDG account",
		Long: "Exchanges a GDG account's stored Google Workspace connection for a short-lived\n" +
			"access token. Only gdgagent-svc's own gdg login credentials can call this — it is\n" +
			"invoked by the xangi authz-server on behalf of a linked Discord user, never by a\n" +
			"sandboxed slot process directly.",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			result, err := service.VendWorkspaceToken(cmd.Context(), sub)
			if err != nil {
				return err
			}
			return writeJSON(cmd, map[string]any{
				"access_token": result.AccessToken,
				"expires_in":   result.ExpiresIn,
			})
		},
	}
	command.Flags().StringVar(&sub, "sub", "", "GDG account sub to vend a Workspace token for")
	_ = command.MarkFlagRequired("sub")
	return command
}

func (service *agentService) VendWorkspaceToken(
	ctx context.Context,
	sub string,
) (accountsapi.WorkspaceTokenResult, error) {
	return service.withAccessToken(ctx, func(accessToken string) (accountsapi.WorkspaceTokenResult, error) {
		return service.client.VendWorkspaceToken(ctx, accessToken, sub)
	})
}

func (service *agentService) withAccessToken(
	ctx context.Context,
	operation func(string) (accountsapi.WorkspaceTokenResult, error),
) (accountsapi.WorkspaceTokenResult, error) {
	credentials, err := service.credentials.Load()
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return accountsapi.WorkspaceTokenResult{}, errors.New("not logged in; run gdg login")
		}
		return accountsapi.WorkspaceTokenResult{}, err
	}
	result, err := operation(credentials.AccessToken)
	if !isUnauthorized(err) {
		return result, err
	}
	refreshed, err := oauth.Refresh(ctx, credentials.RefreshToken)
	if err != nil {
		return accountsapi.WorkspaceTokenResult{}, fmt.Errorf("refresh GDG Japan login: %w", err)
	}
	if err := service.credentials.Save(refreshed); err != nil {
		return accountsapi.WorkspaceTokenResult{}, fmt.Errorf("save refreshed credentials: %w", err)
	}
	return operation(refreshed.AccessToken)
}
