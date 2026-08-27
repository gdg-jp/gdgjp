package command

import (
	"github.com/gdg-jp/gdgjp/cli/internal/cliutil"
	"github.com/gdg-jp/gdgjp/cli/internal/store"
	"github.com/gdg-jp/gdgjp/cli/internal/tinyurl"
	"github.com/spf13/cobra"
)

func newTinyurlDomainsCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "domains",
		Short: "Register and provision custom short-link domains",
	}
	command.AddCommand(newTinyurlDomainsListCommand(credentials))
	command.AddCommand(newTinyurlDomainsGetCommand(credentials))
	command.AddCommand(newTinyurlDomainsCreateCommand(credentials))
	command.AddCommand(newTinyurlDomainsSyncCommand(credentials))
	command.AddCommand(newTinyurlDomainsDeleteCommand(credentials))
	return command
}

func newTinyurlDomainsListCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "list",
		Short: "List domains visible to the caller",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			options := tinyurl.ListDomainsOptions{Page: tinyurlPage(cmd)}
			if cmd.Flags().Changed("chapter-id") {
				chapterID, _ := cmd.Flags().GetInt("chapter-id")
				options.ChapterID = &chapterID
			}
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (tinyurl.DomainList, error) {
				return client.ListDomains(cmd.Context(), token, options)
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	command.Flags().Int("chapter-id", 0, "Filter by chapter id")
	addTinyurlPageFlags(command)
	return command
}

func newTinyurlDomainsGetCommand(credentials store.CredentialStore) *cobra.Command {
	return &cobra.Command{
		Use:   "get DOMAIN_ID",
		Short: "Get a domain by id",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := tinyurlIDArg("DOMAIN_ID", args[0])
			if err != nil {
				return err
			}
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (tinyurl.DomainResponse, error) {
				return client.GetDomain(cmd.Context(), token, id)
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
}

func newTinyurlDomainsCreateCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "create",
		Short: "Register a custom domain and provision it asynchronously",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			hostname, _ := cmd.Flags().GetString("hostname")
			chapterID, _ := cmd.Flags().GetInt("chapter-id")
			wait, _ := cmd.Flags().GetBool("wait")
			body := map[string]any{"hostname": hostname, "chapterId": chapterID}
			return runTinyurlDomainJob(cmd, credentials, wait, func(token string) (tinyurl.JobResponse, error) {
				return tinyurl.NewClient().CreateDomain(cmd.Context(), token, body)
			})
		},
	}
	command.Flags().String("hostname", "", "Custom hostname, e.g. go.example.org")
	command.Flags().Int("chapter-id", 0, "Owning chapter id")
	command.Flags().Bool("wait", false, "Wait for the provisioning job to finish")
	_ = command.MarkFlagRequired("hostname")
	_ = command.MarkFlagRequired("chapter-id")
	return command
}

func newTinyurlDomainsSyncCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "sync DOMAIN_ID",
		Short: "Retry provisioning for a non-active domain",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := tinyurlIDArg("DOMAIN_ID", args[0])
			if err != nil {
				return err
			}
			wait, _ := cmd.Flags().GetBool("wait")
			return runTinyurlDomainJob(cmd, credentials, wait, func(token string) (tinyurl.JobResponse, error) {
				return tinyurl.NewClient().SyncDomain(cmd.Context(), token, id)
			})
		},
	}
	command.Flags().Bool("wait", false, "Wait for the resynchronization job to finish")
	return command
}

func newTinyurlDomainsDeleteCommand(credentials store.CredentialStore) *cobra.Command {
	return &cobra.Command{
		Use:   "delete DOMAIN_ID",
		Short: "Soft-delete a custom domain",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := tinyurlIDArg("DOMAIN_ID", args[0])
			if err != nil {
				return err
			}
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (tinyurl.DomainDeleteResult, error) {
				return client.DeleteDomain(cmd.Context(), token, id)
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
}
