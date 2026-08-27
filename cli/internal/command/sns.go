package command

import (
	"github.com/gdg-jp/gdgjp/cli/internal/sns"
	"github.com/gdg-jp/gdgjp/cli/internal/store"
	"github.com/spf13/cobra"
)

func newSnsCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "sns",
		Short: "Manage scheduled X posts, media, accounts, and contributors on sns.gdgs.jp",
	}
	command.AddCommand(newSnsPostsCommand(credentials))
	command.AddCommand(newSnsMediaCommand(credentials))
	command.AddCommand(newSnsXAccountsCommand(credentials))
	command.AddCommand(newSnsContributorsCommand(credentials))
	return command
}

// addSnsPageFlags registers the API's common --limit/--cursor pagination
// flags on a list command; sns list commands print the server's nextCursor
// rather than auto-paging.
func addSnsPageFlags(cmd *cobra.Command) {
	cmd.Flags().Int("limit", 0, "Maximum number of results")
	cmd.Flags().String("cursor", "", "Pagination cursor from a previous nextCursor")
}

func snsPage(cmd *cobra.Command) sns.Page {
	page := sns.Page{}
	if cmd.Flags().Changed("limit") {
		limit, _ := cmd.Flags().GetInt("limit")
		page.Limit = &limit
	}
	if cmd.Flags().Changed("cursor") {
		cursor, _ := cmd.Flags().GetString("cursor")
		page.Cursor = &cursor
	}
	return page
}
