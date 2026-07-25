package command

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	accountsapi "github.com/gdg-jp/gdgjp/cli/internal/accounts"
	"github.com/gdg-jp/gdgjp/cli/internal/oauth"
	"github.com/gdg-jp/gdgjp/cli/internal/store"
	"github.com/spf13/cobra"
)

type oidcClientService interface {
	Create(context.Context, accountsapi.CreateClientInput) (json.RawMessage, error)
	Update(context.Context, string, accountsapi.UpdateClientInput) (json.RawMessage, error)
	Delete(context.Context, string) error
}

type accountsService struct {
	credentials store.CredentialStore
	client      *accountsapi.Client
}

func newAccountsCommand(credentials store.CredentialStore) *cobra.Command {
	return newAccountsCommandWithService(&accountsService{
		credentials: credentials,
		client:      accountsapi.NewClient(accountsapi.DefaultBaseURL, nil),
	})
}

func newAccountsCommandWithService(service oidcClientService) *cobra.Command {
	accounts := &cobra.Command{
		Use:   "accounts",
		Short: "Manage GDG Japan Accounts resources",
	}
	accounts.AddCommand(newOIDCClientCommand(service))
	return accounts
}

func newOIDCClientCommand(service oidcClientService) *cobra.Command {
	oidcClient := &cobra.Command{
		Use:   "oidc-client",
		Short: "Manage OIDC clients",
	}
	oidcClient.AddCommand(
		newCreateOIDCClientCommand(service),
		newUpdateOIDCClientCommand(service),
		newDeleteOIDCClientCommand(service),
	)
	return oidcClient
}

func newCreateOIDCClientCommand(service oidcClientService) *cobra.Command {
	var name, appURL string
	var redirectURIs, postLogoutRedirectURIs, scopes []string
	command := &cobra.Command{
		Use:   "create",
		Short: "Create an OIDC client",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			if len(redirectURIs) == 0 {
				return errors.New("at least one --redirect-uri is required")
			}
			result, err := service.Create(cmd.Context(), accountsapi.CreateClientInput{
				Name:                   name,
				AppURL:                 appURL,
				RedirectURIs:           redirectURIs,
				PostLogoutRedirectURIs: postLogoutRedirectURIs,
				Scopes:                 scopes,
			})
			if err != nil {
				return err
			}
			return writeJSON(cmd, result)
		},
	}
	command.Flags().StringVar(&name, "name", "", "Application name")
	command.Flags().StringVar(&appURL, "app-url", "", "Application URL")
	command.Flags().StringSliceVar(&redirectURIs, "redirect-uri", nil, "Redirect URI (repeatable)")
	command.Flags().StringSliceVar(
		&postLogoutRedirectURIs,
		"post-logout-redirect-uri",
		nil,
		"Post-logout redirect URI (repeatable)",
	)
	command.Flags().StringSliceVar(&scopes, "scope", nil, "OIDC scope (repeatable)")
	_ = command.MarkFlagRequired("name")
	_ = command.MarkFlagRequired("redirect-uri")
	return command
}

func newUpdateOIDCClientCommand(service oidcClientService) *cobra.Command {
	var name, appURL string
	var redirectURIs, postLogoutRedirectURIs, scopes []string
	var clearAppURL, clearPostLogoutRedirectURIs bool
	command := &cobra.Command{
		Use:   "update CLIENT_ID",
		Short: "Update an OIDC client",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			input := accountsapi.UpdateClientInput{}
			if cmd.Flags().Changed("name") {
				input.Name = &name
			}
			if cmd.Flags().Changed("app-url") {
				input.AppURL = &appURL
			}
			if clearAppURL {
				empty := ""
				input.AppURL = &empty
			}
			if cmd.Flags().Changed("redirect-uri") {
				input.RedirectURIs = redirectURIs
			}
			if cmd.Flags().Changed("post-logout-redirect-uri") {
				input.PostLogoutRedirectURIs = postLogoutRedirectURIs
			}
			if clearPostLogoutRedirectURIs {
				input.PostLogoutRedirectURIs = []string{}
			}
			if cmd.Flags().Changed("scope") {
				input.Scopes = scopes
			}
			if input.Name == nil && input.AppURL == nil && input.RedirectURIs == nil &&
				input.PostLogoutRedirectURIs == nil && input.Scopes == nil {
				return errors.New("specify at least one field to update")
			}
			result, err := service.Update(cmd.Context(), args[0], input)
			if err != nil {
				return err
			}
			return writeJSON(cmd, result)
		},
	}
	command.Flags().StringVar(&name, "name", "", "Application name")
	command.Flags().StringVar(&appURL, "app-url", "", "Application URL")
	command.Flags().BoolVar(&clearAppURL, "clear-app-url", false, "Remove the application URL")
	command.Flags().StringSliceVar(&redirectURIs, "redirect-uri", nil, "Redirect URI (repeatable)")
	command.Flags().StringSliceVar(
		&postLogoutRedirectURIs,
		"post-logout-redirect-uri",
		nil,
		"Post-logout redirect URI (repeatable)",
	)
	command.Flags().BoolVar(
		&clearPostLogoutRedirectURIs,
		"clear-post-logout-redirect-uris",
		false,
		"Remove all post-logout redirect URIs",
	)
	command.Flags().StringSliceVar(&scopes, "scope", nil, "OIDC scope (repeatable)")
	command.MarkFlagsMutuallyExclusive("app-url", "clear-app-url")
	command.MarkFlagsMutuallyExclusive(
		"post-logout-redirect-uri",
		"clear-post-logout-redirect-uris",
	)
	return command
}

func newDeleteOIDCClientCommand(service oidcClientService) *cobra.Command {
	var yes bool
	command := &cobra.Command{
		Use:   "delete CLIENT_ID",
		Short: "Delete an OIDC client",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if !yes {
				return errors.New("refusing to delete without --yes")
			}
			if err := service.Delete(cmd.Context(), args[0]); err != nil {
				return err
			}
			return writeJSON(cmd, map[string]any{"client_id": args[0], "deleted": true})
		},
	}
	command.Flags().BoolVarP(&yes, "yes", "y", false, "Confirm deletion")
	return command
}

func (service *accountsService) Create(
	ctx context.Context,
	input accountsapi.CreateClientInput,
) (json.RawMessage, error) {
	return service.withAccessToken(ctx, func(accessToken string) (json.RawMessage, error) {
		return service.client.CreateOIDCClient(ctx, accessToken, input)
	})
}

func (service *accountsService) Update(
	ctx context.Context,
	clientID string,
	input accountsapi.UpdateClientInput,
) (json.RawMessage, error) {
	return service.withAccessToken(ctx, func(accessToken string) (json.RawMessage, error) {
		return service.client.UpdateOIDCClient(ctx, accessToken, clientID, input)
	})
}

func (service *accountsService) Delete(ctx context.Context, clientID string) error {
	_, err := service.withAccessToken(ctx, func(accessToken string) (json.RawMessage, error) {
		return nil, service.client.DeleteOIDCClient(ctx, accessToken, clientID)
	})
	return err
}

func (service *accountsService) withAccessToken(
	ctx context.Context,
	operation func(string) (json.RawMessage, error),
) (json.RawMessage, error) {
	credentials, err := service.credentials.Load()
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return nil, errors.New("not logged in; run gdg login")
		}
		return nil, err
	}
	result, err := operation(credentials.AccessToken)
	if !isUnauthorized(err) {
		return result, err
	}
	refreshed, err := oauth.Refresh(ctx, credentials.RefreshToken)
	if err != nil {
		return nil, fmt.Errorf("refresh GDG Japan login: %w", err)
	}
	if err := service.credentials.Save(refreshed); err != nil {
		return nil, fmt.Errorf("save refreshed credentials: %w", err)
	}
	return operation(refreshed.AccessToken)
}

func isUnauthorized(err error) bool {
	var httpError *accountsapi.HTTPError
	return errors.As(err, &httpError) && httpError.StatusCode == 401
}

func writeJSON(cmd *cobra.Command, value any) error {
	contents, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintln(cmd.OutOrStdout(), strings.TrimSpace(string(contents)))
	return err
}
