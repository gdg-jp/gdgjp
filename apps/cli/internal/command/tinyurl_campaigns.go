package command

import (
	"fmt"
	"time"

	"github.com/gdg-jp/gdgjp/cli/internal/cliutil"
	"github.com/gdg-jp/gdgjp/cli/internal/store"
	"github.com/gdg-jp/gdgjp/cli/internal/tinyurl"
	"github.com/spf13/cobra"
)

func newTinyurlCampaignsCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "campaigns",
		Short: "Manage attribution campaigns, channels, sources, and analytics",
	}
	command.AddCommand(newTinyurlCampaignsListCommand(credentials))
	command.AddCommand(newTinyurlCampaignsCreateCommand(credentials))
	command.AddCommand(newTinyurlCampaignsGetCommand(credentials))
	command.AddCommand(newTinyurlCampaignsUpdateCommand(credentials))
	command.AddCommand(newTinyurlCampaignsArchiveCommand(credentials))
	command.AddCommand(newTinyurlCampaignsRestoreCommand(credentials))
	command.AddCommand(newTinyurlCampaignChannelsCommand(credentials))
	command.AddCommand(newTinyurlCampaignSourcesCommand(credentials))
	command.AddCommand(newTinyurlCampaignAnalyticsCommand(credentials))
	return command
}

// addTinyurlArchivedListFlags registers --include-archived plus the shared
// pagination flags on a campaigns/channels/sources list command.
func addTinyurlArchivedListFlags(cmd *cobra.Command) {
	cmd.Flags().Bool("include-archived", false, "Include archived rows")
	addTinyurlPageFlags(cmd)
}

func tinyurlArchivedListOptions(cmd *cobra.Command) tinyurl.ListCampaignOptions {
	options := tinyurl.ListCampaignOptions{Page: tinyurlPage(cmd)}
	if cmd.Flags().Changed("include-archived") {
		value, _ := cmd.Flags().GetBool("include-archived")
		options.IncludeArchived = &value
	}
	return options
}

// --- campaigns ---------------------------------------------------------------

func newTinyurlCampaignsListCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "list",
		Short: "List the caller's campaigns",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (tinyurl.CliCampaignList, error) {
				return client.ListCampaigns(cmd.Context(), token, tinyurlArchivedListOptions(cmd))
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	addTinyurlArchivedListFlags(command)
	return command
}

func campaignBody(cmd *cobra.Command, create bool) map[string]any {
	body := map[string]any{}
	if create || cmd.Flags().Changed("name") {
		name, _ := cmd.Flags().GetString("name")
		body["name"] = name
	}
	if create || cmd.Flags().Changed("code") {
		code, _ := cmd.Flags().GetString("code")
		body["code"] = code
	}
	if create || cmd.Flags().Changed("chapter-id") {
		chapterIDs, _ := cmd.Flags().GetIntSlice("chapter-id")
		body["chapterIds"] = chapterIDs
	}
	if cmd.Flags().Changed("default-destination-url") {
		url, _ := cmd.Flags().GetString("default-destination-url")
		body["defaultDestinationUrl"] = url
	}
	return body
}

func addTinyurlCampaignFieldFlags(cmd *cobra.Command) {
	cmd.Flags().String("name", "", "Campaign name")
	cmd.Flags().String("code", "", "Campaign code")
	cmd.Flags().IntSlice("chapter-id", nil, "Owning chapter id (repeatable)")
	cmd.Flags().String("default-destination-url", "", "Fallback destination URL for the campaign")
}

func newTinyurlCampaignsCreateCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "create",
		Short: "Create a campaign",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (tinyurl.CliCampaignResponse, error) {
				return client.CreateCampaign(cmd.Context(), token, campaignBody(cmd, true))
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	addTinyurlCampaignFieldFlags(command)
	_ = command.MarkFlagRequired("name")
	_ = command.MarkFlagRequired("code")
	_ = command.MarkFlagRequired("chapter-id")
	return command
}

func newTinyurlCampaignsGetCommand(credentials store.CredentialStore) *cobra.Command {
	return &cobra.Command{
		Use:   "get CAMPAIGN_ID",
		Short: "Get a campaign",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := tinyurlIDArg("CAMPAIGN_ID", args[0])
			if err != nil {
				return err
			}
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (tinyurl.CliCampaignResponse, error) {
				return client.GetCampaign(cmd.Context(), token, id)
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
}

func newTinyurlCampaignsUpdateCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "update CAMPAIGN_ID",
		Short: "Update a campaign",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := tinyurlIDArg("CAMPAIGN_ID", args[0])
			if err != nil {
				return err
			}
			body := campaignBody(cmd, false)
			if len(body) == 0 {
				return fmt.Errorf("specify at least one field to update")
			}
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (tinyurl.CliCampaignResponse, error) {
				return client.UpdateCampaign(cmd.Context(), token, id, body)
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	addTinyurlCampaignFieldFlags(command)
	return command
}

func newTinyurlCampaignsArchiveCommand(credentials store.CredentialStore) *cobra.Command {
	return &cobra.Command{
		Use:   "archive CAMPAIGN_ID",
		Short: "Archive a campaign",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := tinyurlIDArg("CAMPAIGN_ID", args[0])
			if err != nil {
				return err
			}
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (tinyurl.CliArchiveResult, error) {
				return client.ArchiveCampaign(cmd.Context(), token, id)
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
}

func newTinyurlCampaignsRestoreCommand(credentials store.CredentialStore) *cobra.Command {
	return &cobra.Command{
		Use:   "restore CAMPAIGN_ID",
		Short: "Restore an archived campaign",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := tinyurlIDArg("CAMPAIGN_ID", args[0])
			if err != nil {
				return err
			}
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (tinyurl.CliCampaignResponse, error) {
				return client.RestoreCampaign(cmd.Context(), token, id)
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
}

// --- campaign channels -----------------------------------------------------

func newTinyurlCampaignChannelsCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "channels",
		Short: "Manage a campaign's channels",
	}
	command.AddCommand(newTinyurlChannelsListCommand(credentials))
	command.AddCommand(newTinyurlChannelsCreateCommand(credentials))
	command.AddCommand(newTinyurlChannelsUpdateCommand(credentials))
	command.AddCommand(newTinyurlChannelsArchiveCommand(credentials))
	command.AddCommand(newTinyurlChannelsRestoreCommand(credentials))
	return command
}

func addCampaignIDFlag(cmd *cobra.Command) {
	cmd.Flags().Int("campaign-id", 0, "Campaign id")
	_ = cmd.MarkFlagRequired("campaign-id")
}

func addChannelIDFlag(cmd *cobra.Command) {
	cmd.Flags().Int("channel-id", 0, "Channel id")
	_ = cmd.MarkFlagRequired("channel-id")
}

func addSourceIDFlag(cmd *cobra.Command) {
	cmd.Flags().Int("source-id", 0, "Source id")
	_ = cmd.MarkFlagRequired("source-id")
}

func channelBody(cmd *cobra.Command, create bool) map[string]any {
	body := map[string]any{}
	if create || cmd.Flags().Changed("name") {
		name, _ := cmd.Flags().GetString("name")
		body["name"] = name
	}
	if create || cmd.Flags().Changed("code") {
		code, _ := cmd.Flags().GetString("code")
		body["code"] = code
	}
	if cmd.Flags().Changed("sort-order") {
		sortOrder, _ := cmd.Flags().GetInt("sort-order")
		body["sortOrder"] = sortOrder
	}
	return body
}

func newTinyurlChannelsListCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "list",
		Short: "List a campaign's channels",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			campaignID, _ := cmd.Flags().GetInt("campaign-id")
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (tinyurl.CliCampaignChannelList, error) {
				return client.ListChannels(cmd.Context(), token, campaignID, tinyurlArchivedListOptions(cmd))
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	addCampaignIDFlag(command)
	addTinyurlArchivedListFlags(command)
	return command
}

func newTinyurlChannelsCreateCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "create",
		Short: "Create a campaign channel",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			campaignID, _ := cmd.Flags().GetInt("campaign-id")
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (tinyurl.CliCampaignChannelResponse, error) {
				return client.CreateChannel(cmd.Context(), token, campaignID, channelBody(cmd, true))
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	addCampaignIDFlag(command)
	command.Flags().String("name", "", "Channel name")
	command.Flags().String("code", "", "Channel code")
	command.Flags().Int("sort-order", 0, "Sort order")
	_ = command.MarkFlagRequired("name")
	_ = command.MarkFlagRequired("code")
	return command
}

func newTinyurlChannelsUpdateCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "update",
		Short: "Update a campaign channel",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			campaignID, _ := cmd.Flags().GetInt("campaign-id")
			channelID, _ := cmd.Flags().GetInt("channel-id")
			body := channelBody(cmd, false)
			if len(body) == 0 {
				return fmt.Errorf("specify at least one field to update")
			}
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (tinyurl.CliCampaignChannelResponse, error) {
				return client.UpdateChannel(cmd.Context(), token, campaignID, channelID, body)
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	addCampaignIDFlag(command)
	addChannelIDFlag(command)
	command.Flags().String("name", "", "Channel name")
	command.Flags().String("code", "", "Channel code")
	command.Flags().Int("sort-order", 0, "Sort order")
	return command
}

func newTinyurlChannelsArchiveCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "archive",
		Short: "Archive a campaign channel",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			campaignID, _ := cmd.Flags().GetInt("campaign-id")
			channelID, _ := cmd.Flags().GetInt("channel-id")
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (tinyurl.CliArchiveResult, error) {
				return client.ArchiveChannel(cmd.Context(), token, campaignID, channelID)
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	addCampaignIDFlag(command)
	addChannelIDFlag(command)
	return command
}

func newTinyurlChannelsRestoreCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "restore",
		Short: "Restore an archived campaign channel",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			campaignID, _ := cmd.Flags().GetInt("campaign-id")
			channelID, _ := cmd.Flags().GetInt("channel-id")
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (tinyurl.CliCampaignChannelResponse, error) {
				return client.RestoreChannel(cmd.Context(), token, campaignID, channelID)
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	addCampaignIDFlag(command)
	addChannelIDFlag(command)
	return command
}

// --- campaign channel sources ------------------------------------------------

func newTinyurlCampaignSourcesCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "sources",
		Short: "Manage a channel's sources",
	}
	command.AddCommand(newTinyurlSourcesListCommand(credentials))
	command.AddCommand(newTinyurlSourcesCreateCommand(credentials))
	command.AddCommand(newTinyurlSourcesUpdateCommand(credentials))
	command.AddCommand(newTinyurlSourcesArchiveCommand(credentials))
	command.AddCommand(newTinyurlSourcesRestoreCommand(credentials))
	return command
}

func sourceBody(cmd *cobra.Command, create bool) map[string]any {
	body := map[string]any{}
	if create || cmd.Flags().Changed("name") {
		name, _ := cmd.Flags().GetString("name")
		body["name"] = name
	}
	if create || cmd.Flags().Changed("code") {
		code, _ := cmd.Flags().GetString("code")
		body["code"] = code
	}
	return body
}

func newTinyurlSourcesListCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "list",
		Short: "List a channel's sources",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			campaignID, _ := cmd.Flags().GetInt("campaign-id")
			channelID, _ := cmd.Flags().GetInt("channel-id")
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (tinyurl.CliCampaignChannelSourceList, error) {
				return client.ListSources(cmd.Context(), token, campaignID, channelID, tinyurlArchivedListOptions(cmd))
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	addCampaignIDFlag(command)
	addChannelIDFlag(command)
	addTinyurlArchivedListFlags(command)
	return command
}

func newTinyurlSourcesCreateCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "create",
		Short: "Create a channel source",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			campaignID, _ := cmd.Flags().GetInt("campaign-id")
			channelID, _ := cmd.Flags().GetInt("channel-id")
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (tinyurl.CliCampaignChannelSourceResponse, error) {
				return client.CreateSource(cmd.Context(), token, campaignID, channelID, sourceBody(cmd, true))
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	addCampaignIDFlag(command)
	addChannelIDFlag(command)
	command.Flags().String("name", "", "Source name")
	command.Flags().String("code", "", "Source code")
	_ = command.MarkFlagRequired("name")
	_ = command.MarkFlagRequired("code")
	return command
}

func newTinyurlSourcesUpdateCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "update",
		Short: "Update a channel source",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			campaignID, _ := cmd.Flags().GetInt("campaign-id")
			channelID, _ := cmd.Flags().GetInt("channel-id")
			sourceID, _ := cmd.Flags().GetInt("source-id")
			body := sourceBody(cmd, false)
			if len(body) == 0 {
				return fmt.Errorf("specify at least one field to update")
			}
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (tinyurl.CliCampaignChannelSourceResponse, error) {
				return client.UpdateSource(cmd.Context(), token, campaignID, channelID, sourceID, body)
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	addCampaignIDFlag(command)
	addChannelIDFlag(command)
	addSourceIDFlag(command)
	command.Flags().String("name", "", "Source name")
	command.Flags().String("code", "", "Source code")
	return command
}

func newTinyurlSourcesArchiveCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "archive",
		Short: "Archive a channel source",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			campaignID, _ := cmd.Flags().GetInt("campaign-id")
			channelID, _ := cmd.Flags().GetInt("channel-id")
			sourceID, _ := cmd.Flags().GetInt("source-id")
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (tinyurl.CliArchiveResult, error) {
				return client.ArchiveSource(cmd.Context(), token, campaignID, channelID, sourceID)
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	addCampaignIDFlag(command)
	addChannelIDFlag(command)
	addSourceIDFlag(command)
	return command
}

func newTinyurlSourcesRestoreCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "restore",
		Short: "Restore an archived channel source",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			campaignID, _ := cmd.Flags().GetInt("campaign-id")
			channelID, _ := cmd.Flags().GetInt("channel-id")
			sourceID, _ := cmd.Flags().GetInt("source-id")
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (tinyurl.CliCampaignChannelSourceResponse, error) {
				return client.RestoreSource(cmd.Context(), token, campaignID, channelID, sourceID)
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	addCampaignIDFlag(command)
	addChannelIDFlag(command)
	addSourceIDFlag(command)
	return command
}

// --- campaign analytics --------------------------------------------------

func newTinyurlCampaignAnalyticsCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "analytics CAMPAIGN_ID",
		Short: "Query aggregate campaign analytics over an explicit window",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := tinyurlIDArg("CAMPAIGN_ID", args[0])
			if err != nil {
				return err
			}
			fromRaw, _ := cmd.Flags().GetString("from")
			toRaw, _ := cmd.Flags().GetString("to")
			from, err := time.Parse(time.RFC3339, fromRaw)
			if err != nil {
				return fmt.Errorf("--from must be an ISO instant (e.g. 2026-01-01T00:00:00Z): %w", err)
			}
			to, err := time.Parse(time.RFC3339, toRaw)
			if err != nil {
				return fmt.Errorf("--to must be an ISO instant (e.g. 2026-01-01T00:00:00Z): %w", err)
			}
			if err := tinyurl.ValidateAnalyticsWindow(from, to); err != nil {
				return err
			}
			options := tinyurl.AnalyticsOptions{From: from, To: to}
			if cmd.Flags().Changed("bucket") {
				bucket, _ := cmd.Flags().GetString("bucket")
				options.Bucket = &bucket
			}
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (tinyurl.CliCampaignAnalyticsResponse, error) {
				return client.CampaignAnalytics(cmd.Context(), token, id, options)
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	command.Flags().String("from", "", "Inclusive window start as an ISO instant (required)")
	command.Flags().String("to", "", "Inclusive window end as an ISO instant (required)")
	command.Flags().String("bucket", "", "Trend bucket: hour or day")
	_ = command.MarkFlagRequired("from")
	_ = command.MarkFlagRequired("to")
	return command
}
