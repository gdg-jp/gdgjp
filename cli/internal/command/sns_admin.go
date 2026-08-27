package command

import (
	"encoding/json"

	"github.com/gdg-jp/gdgjp/cli/internal/cliutil"
	"github.com/gdg-jp/gdgjp/cli/internal/sns"
	"github.com/gdg-jp/gdgjp/cli/internal/store"
	"github.com/spf13/cobra"
)

// --- X accounts ----------------------------------------------------------

func newSnsXAccountsCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "x-accounts",
		Short: "Discover and revoke a chapter's X accounts",
	}
	command.AddCommand(newSnsXAccountsListCommand(credentials))
	command.AddCommand(newSnsXAccountsRevokeCommand(credentials))
	return command
}

func newSnsXAccountsListCommand(credentials store.CredentialStore) *cobra.Command {
	var chapterID int
	command := &cobra.Command{
		Use:   "list",
		Short: "List a chapter's usable X accounts",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			client := sns.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (json.RawMessage, error) {
				return client.ListXAccounts(cmd.Context(), token, chapterID)
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	command.Flags().IntVar(&chapterID, "chapter-id", 0, "Chapter id whose X accounts to list")
	_ = command.MarkFlagRequired("chapter-id")
	return command
}

func newSnsXAccountsRevokeCommand(credentials store.CredentialStore) *cobra.Command {
	var xUserID string
	command := &cobra.Command{
		Use:   "revoke ACCOUNT_ID",
		Short: "Revoke a chapter's X account",
		Long: "Revoke a chapter's X account.\n\n" +
			"--x-user-id must exactly match the account's current xUserId, matching\n" +
			"the dashboard's revoke confirmation and guarding against an accidental\n" +
			"revoke of the wrong account.",
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := sns.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (json.RawMessage, error) {
				return client.RevokeXAccount(cmd.Context(), token, args[0], xUserID)
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	command.Flags().StringVar(&xUserID, "x-user-id", "", "The account's current xUserId, as a safety confirmation")
	_ = command.MarkFlagRequired("x-user-id")
	return command
}

// --- contributors ------------------------------------------------------

func newSnsContributorsCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "contributors",
		Short: "Manage a chapter's contributors (organizer only)",
	}
	command.AddCommand(newSnsContributorsListCommand(credentials))
	command.AddCommand(newSnsContributorsAddCommand(credentials))
	command.AddCommand(newSnsContributorsRemoveCommand(credentials))
	return command
}

func newSnsContributorsListCommand(credentials store.CredentialStore) *cobra.Command {
	var chapterID int
	command := &cobra.Command{
		Use:   "list",
		Short: "List a chapter's contributors",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			client := sns.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (json.RawMessage, error) {
				return client.ListContributors(cmd.Context(), token, chapterID, snsPage(cmd))
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	command.Flags().IntVar(&chapterID, "chapter-id", 0, "Chapter id whose contributors to list")
	addSnsPageFlags(command)
	_ = command.MarkFlagRequired("chapter-id")
	return command
}

func newSnsContributorsAddCommand(credentials store.CredentialStore) *cobra.Command {
	var chapterID int
	var email string
	command := &cobra.Command{
		Use:   "add",
		Short: "Grant a user contributor access to a chapter",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			client := sns.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (json.RawMessage, error) {
				return client.AddContributor(cmd.Context(), token, chapterID, email)
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	command.Flags().IntVar(&chapterID, "chapter-id", 0, "Chapter id to grant access to")
	command.Flags().StringVar(&email, "email", "", "Email of the user to grant contributor access")
	_ = command.MarkFlagRequired("chapter-id")
	_ = command.MarkFlagRequired("email")
	return command
}

// newSnsContributorsRemoveCommand takes --chapter-id / --email flags, not a
// positional id: the sns_contributors table is keyed by (chapter_id,
// user_email) and has no single-column id to address.
func newSnsContributorsRemoveCommand(credentials store.CredentialStore) *cobra.Command {
	var chapterID int
	var email string
	command := &cobra.Command{
		Use:   "remove",
		Short: "Revoke a user's contributor access to a chapter",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			client := sns.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (json.RawMessage, error) {
				return client.RemoveContributor(cmd.Context(), token, chapterID, email)
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	command.Flags().IntVar(&chapterID, "chapter-id", 0, "Chapter id the grant belongs to")
	command.Flags().StringVar(&email, "email", "", "Email of the user whose access to revoke")
	_ = command.MarkFlagRequired("chapter-id")
	_ = command.MarkFlagRequired("email")
	return command
}
