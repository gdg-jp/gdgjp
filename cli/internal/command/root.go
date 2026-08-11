package command

import (
	"fmt"

	"github.com/gdg-jp/gdgjp/cli/internal/oauth"
	"github.com/gdg-jp/gdgjp/cli/internal/store"
	"github.com/gdg-jp/gdgjp/cli/internal/update"
	"github.com/spf13/cobra"
)

var version = "dev"

func NewRoot() *cobra.Command {
	credentials := store.NewCredentials()
	root := &cobra.Command{
		Use:     "gdg",
		Short:   "GDG Japan command-line tool",
		Version: version,
	}
	root.AddCommand(newLoginCommand(credentials), newLogoutCommand(credentials), newUpdateCommand())
	root.AddCommand(newAccountsCommand(credentials))
	root.AddCommand(newWikiCommand(credentials))
	root.AddCommand(newConnpassCommand(credentials))
	return root
}

func newLoginCommand(credentials store.CredentialStore) *cobra.Command {
	return &cobra.Command{
		Use:   "login",
		Short: "Sign in to GDG Japan in your browser",
		RunE: func(cmd *cobra.Command, _ []string) error {
			result, err := oauth.Login(cmd.Context())
			if err != nil {
				return err
			}
			if err := credentials.Save(result); err != nil {
				return err
			}
			fmt.Fprintln(cmd.OutOrStdout(), "Logged in to GDG Japan.")
			return nil
		},
	}
}

func newLogoutCommand(credentials store.CredentialStore) *cobra.Command {
	return &cobra.Command{
		Use:   "logout",
		Short: "Revoke this CLI session and remove local credentials",
		RunE: func(cmd *cobra.Command, _ []string) error {
			credential, err := credentials.Load()
			if err == store.ErrNotFound {
				fmt.Fprintln(cmd.OutOrStdout(), "Not logged in.")
				return nil
			}
			if err != nil {
				return err
			}
			remoteErr := oauth.Logout(cmd.Context(), credential)
			if err := credentials.Delete(); err != nil && err != store.ErrNotFound {
				return err
			}
			if remoteErr != nil {
				return fmt.Errorf("local credentials removed, but remote logout failed: %w", remoteErr)
			}
			fmt.Fprintln(cmd.OutOrStdout(), "Logged out.")
			return nil
		},
	}
}

func newUpdateCommand() *cobra.Command {
	var yes bool
	command := &cobra.Command{
		Use:   "update",
		Short: "Update gdg to the latest stable release",
		RunE: func(cmd *cobra.Command, _ []string) error {
			return update.Run(cmd.Context(), cmd.OutOrStdout(), version, yes)
		},
	}
	command.Flags().BoolVarP(&yes, "yes", "y", false, "Update without confirmation")
	return command
}
