package command

import (
	"time"

	"github.com/gdg-jp/gdgjp/cli/internal/cliutil"
	"github.com/gdg-jp/gdgjp/cli/internal/store"
	"github.com/gdg-jp/gdgjp/cli/internal/tinyurl"
	"github.com/spf13/cobra"
)

func newTinyurlCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "tinyurl",
		Short: "Manage short links, domains, and campaigns on url.gdgs.jp",
	}
	command.AddCommand(newTinyurlLinksCommand(credentials))
	command.AddCommand(newTinyurlTagsCommand(credentials))
	command.AddCommand(newTinyurlFoldersCommand(credentials))
	command.AddCommand(newTinyurlDomainsCommand(credentials))
	command.AddCommand(newTinyurlJobsCommand(credentials))
	command.AddCommand(newTinyurlCampaignsCommand(credentials))
	return command
}

// addTinyurlPageFlags registers the API's common --limit/--cursor pagination
// flags on a list command; every tinyurl list command carries them and
// prints the server's nextCursor rather than auto-paging.
func addTinyurlPageFlags(cmd *cobra.Command) {
	cmd.Flags().Int("limit", 0, "Maximum number of results")
	cmd.Flags().String("cursor", "", "Pagination cursor from a previous nextCursor")
}

func tinyurlPage(cmd *cobra.Command) tinyurl.Page {
	page := tinyurl.Page{}
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

// printJSON is the shared success path: indented JSON, 1:1 with the server's
// response body.
func printJSON(cmd *cobra.Command, value any) error {
	return cliutil.PrintJSON(cmd.OutOrStdout(), value)
}

// runTinyurlDomainJob starts an async domain provisioning job and, when
// --wait is set, blocks on the shared jobs endpoint until it reaches a
// terminal state, exiting non-zero if the job failed. Mirrors connpass's
// runConnpassJob / addWaitFlag precedent.
func runTinyurlDomainJob(
	cmd *cobra.Command,
	credentials store.CredentialStore,
	wait bool,
	start func(token string) (tinyurl.JobResponse, error),
) error {
	client := tinyurl.NewClient()
	started, err := cliutil.WithToken(cmd.Context(), credentials, start)
	if err != nil {
		return err
	}
	if !wait {
		return printJSON(cmd, started)
	}
	job, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (tinyurl.Job, error) {
		return client.WaitJob(cmd.Context(), token, started.Job.Id, 2*time.Second)
	})
	if err != nil {
		return err
	}
	if fail := tinyurl.JobFailed(job); fail != nil {
		return fail
	}
	return printJSON(cmd, job)
}
