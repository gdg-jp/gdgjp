package command

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/gdg-jp/gdgjp/cli/internal/cliutil"
	"github.com/gdg-jp/gdgjp/cli/internal/store"
	"github.com/gdg-jp/gdgjp/cli/internal/tinyurl"
	"github.com/spf13/cobra"
)

func newTinyurlLinksCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "links",
		Short: "Manage short links",
	}
	command.AddCommand(newTinyurlLinksListCommand(credentials))
	command.AddCommand(newTinyurlLinksCreateCommand(credentials))
	command.AddCommand(newTinyurlLinksGetCommand(credentials))
	command.AddCommand(newTinyurlLinksUpdateCommand(credentials))
	command.AddCommand(newTinyurlLinksDeleteCommand(credentials))
	return command
}

func newTinyurlLinksListCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "list",
		Short: "List links visible to the caller",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			options := tinyurl.ListLinksOptions{Page: tinyurlPage(cmd)}
			if cmd.Flags().Changed("folder-id") {
				folderID, _ := cmd.Flags().GetInt("folder-id")
				options.FolderID = &folderID
			}
			if cmd.Flags().Changed("tag-id") {
				tagID, _ := cmd.Flags().GetInt("tag-id")
				options.TagID = &tagID
			}
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (json.RawMessage, error) {
				return client.ListLinks(cmd.Context(), token, options)
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	command.Flags().Int("folder-id", 0, "Filter by folder id")
	command.Flags().Int("tag-id", 0, "Filter by tag id")
	addTinyurlPageFlags(command)
	return command
}

// linkBody builds the create/update payload from the shared link flags. On
// create, domainId/slug/destinationUrl are always included and visibility
// defaults to private; on update every field is optional and only changed
// flags are sent.
func linkBody(cmd *cobra.Command, create bool) (map[string]any, error) {
	body := map[string]any{}
	if create {
		domainID, _ := cmd.Flags().GetInt("domain-id")
		slug, _ := cmd.Flags().GetString("slug")
		url, _ := cmd.Flags().GetString("url")
		visibility, _ := cmd.Flags().GetString("visibility")
		body["domainId"] = domainID
		body["slug"] = slug
		body["destinationUrl"] = url
		body["visibility"] = visibility
	} else {
		if cmd.Flags().Changed("slug") {
			slug, _ := cmd.Flags().GetString("slug")
			body["slug"] = slug
		}
		if cmd.Flags().Changed("url") {
			url, _ := cmd.Flags().GetString("url")
			body["destinationUrl"] = url
		}
		if cmd.Flags().Changed("visibility") {
			visibility, _ := cmd.Flags().GetString("visibility")
			body["visibility"] = visibility
		}
	}
	if cmd.Flags().Changed("title") {
		title, _ := cmd.Flags().GetString("title")
		body["title"] = title
	}
	if cmd.Flags().Changed("folder-id") {
		folderID, _ := cmd.Flags().GetInt("folder-id")
		body["folderId"] = folderID
	}
	if cmd.Flags().Changed("campaign-channel-id") {
		channelID, _ := cmd.Flags().GetInt("campaign-channel-id")
		body["campaignChannelId"] = channelID
	}
	if cmd.Flags().Changed("tag-id") {
		tagIDs, _ := cmd.Flags().GetIntSlice("tag-id")
		body["tagIds"] = tagIDs
	}
	if cmd.Flags().Changed("new-tag") {
		names, _ := cmd.Flags().GetStringArray("new-tag")
		body["newTagNames"] = names
	}
	if cmd.Flags().Changed("share") {
		raw, _ := cmd.Flags().GetStringArray("share")
		shares, err := parseShares(raw)
		if err != nil {
			return nil, err
		}
		body["shares"] = shares
	}
	return body, nil
}

// parseShares turns repeated --share TYPE:ID:ROLE flags into the API's
// { principalType, principalId, role } objects.
func parseShares(raw []string) ([]map[string]any, error) {
	shares := make([]map[string]any, 0, len(raw))
	for _, entry := range raw {
		parts := strings.SplitN(entry, ":", 3)
		if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
			return nil, fmt.Errorf("--share %q must be TYPE:ID:ROLE", entry)
		}
		shares = append(shares, map[string]any{
			"principalType": parts[0],
			"principalId":   parts[1],
			"role":          parts[2],
		})
	}
	return shares, nil
}

// addTinyurlLinkFieldFlags registers the link fields shared by create and
// update. --visibility keeps its "private" default so create always sends a
// valid value; update only forwards it when explicitly changed.
func addTinyurlLinkFieldFlags(cmd *cobra.Command) {
	cmd.Flags().String("slug", "", "Short link slug")
	cmd.Flags().String("url", "", "Destination URL")
	cmd.Flags().String("title", "", "Link title")
	cmd.Flags().Int("folder-id", 0, "Folder id")
	cmd.Flags().Int("campaign-channel-id", 0, "Campaign channel id to attribute clicks to")
	cmd.Flags().String("visibility", "private", "Link visibility: private or public")
	cmd.Flags().IntSlice("tag-id", nil, "Existing tag id to attach (repeatable)")
	cmd.Flags().StringArray("new-tag", nil, "Name of a new tag to create and attach (repeatable)")
	cmd.Flags().StringArray("share", nil, "Grant access as TYPE:ID:ROLE (repeatable), e.g. user:a@b.com:editor")
}

func newTinyurlLinksCreateCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "create",
		Short: "Create a short link",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			body, err := linkBody(cmd, true)
			if err != nil {
				return err
			}
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (json.RawMessage, error) {
				return client.CreateLink(cmd.Context(), token, body)
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	command.Flags().Int("domain-id", 0, "Domain id the slug lives under")
	addTinyurlLinkFieldFlags(command)
	_ = command.MarkFlagRequired("domain-id")
	_ = command.MarkFlagRequired("slug")
	_ = command.MarkFlagRequired("url")
	return command
}

func newTinyurlLinksGetCommand(credentials store.CredentialStore) *cobra.Command {
	return &cobra.Command{
		Use:   "get LINK_ID",
		Short: "Get a link",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (json.RawMessage, error) {
				return client.GetLink(cmd.Context(), token, args[0])
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
}

func newTinyurlLinksUpdateCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "update LINK_ID",
		Short: "Update a link",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			body, err := linkBody(cmd, false)
			if err != nil {
				return err
			}
			if len(body) == 0 {
				return fmt.Errorf("specify at least one field to update")
			}
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (json.RawMessage, error) {
				return client.UpdateLink(cmd.Context(), token, args[0], body)
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	addTinyurlLinkFieldFlags(command)
	return command
}

func newTinyurlLinksDeleteCommand(credentials store.CredentialStore) *cobra.Command {
	return &cobra.Command{
		Use:   "delete LINK_ID",
		Short: "Soft delete a link",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (json.RawMessage, error) {
				return client.DeleteLink(cmd.Context(), token, args[0])
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
}
