package command

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/gdg-jp/gdgjp/cli/internal/cliutil"
	"github.com/gdg-jp/gdgjp/cli/internal/sns"
	"github.com/gdg-jp/gdgjp/cli/internal/store"
	"github.com/spf13/cobra"
)

func newSnsPostsCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "posts",
		Short: "Manage scheduled X post drafts",
	}
	command.AddCommand(newSnsPostsListCommand(credentials))
	command.AddCommand(newSnsPostsCreateCommand(credentials))
	command.AddCommand(newSnsPostsGetCommand(credentials))
	command.AddCommand(newSnsPostsUpdateCommand(credentials))
	command.AddCommand(newSnsPostsDeleteCommand(credentials))
	command.AddCommand(newSnsPostsPublishCommand(credentials))
	return command
}

func newSnsPostsListCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "list",
		Short: "List a chapter's scheduled posts",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			chapterID, _ := cmd.Flags().GetInt("chapter-id")
			options := sns.ListPostsOptions{ChapterID: chapterID, Page: snsPage(cmd)}
			if cmd.Flags().Changed("status") {
				status, _ := cmd.Flags().GetString("status")
				options.Status = &status
			}
			client := sns.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (json.RawMessage, error) {
				return client.ListPosts(cmd.Context(), token, options)
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	command.Flags().Int("chapter-id", 0, "Chapter id whose posts to list")
	command.Flags().String("status", "", "Filter by status: scheduled, waiting_for_photo, posting, published, failed, needs_confirmation")
	addSnsPageFlags(command)
	_ = command.MarkFlagRequired("chapter-id")
	return command
}

// postBody builds the create/update payload from the shared post flags. On
// create, chapterId/xAccountId/text/scheduledAt/condition are always
// included; on update every field is optional and only changed flags are
// sent.
func postBody(cmd *cobra.Command, create bool) map[string]any {
	body := map[string]any{}
	if create {
		chapterID, _ := cmd.Flags().GetInt("chapter-id")
		body["chapterId"] = chapterID
	}
	if create || cmd.Flags().Changed("x-account-id") {
		xAccountID, _ := cmd.Flags().GetString("x-account-id")
		body["xAccountId"] = xAccountID
	}
	if create || cmd.Flags().Changed("text") {
		text, _ := cmd.Flags().GetString("text")
		body["text"] = text
	}
	if create || cmd.Flags().Changed("scheduled-at") {
		scheduledAt, _ := cmd.Flags().GetString("scheduled-at")
		body["scheduledAt"] = scheduledAt
	}
	if create || cmd.Flags().Changed("condition") {
		condition, _ := cmd.Flags().GetString("condition")
		body["condition"] = condition
	}
	if cmd.Flags().Changed("tag-handle") {
		handles, _ := cmd.Flags().GetStringArray("tag-handle")
		body["tagHandles"] = handles
	}
	return body
}

// addSnsPostFieldFlags registers the post fields shared by create and update.
func addSnsPostFieldFlags(cmd *cobra.Command) {
	cmd.Flags().String("x-account-id", "", "X account id to post from (see: gdg sns x-accounts list)")
	cmd.Flags().String("text", "", "Post text")
	cmd.Flags().String("scheduled-at", "", "Scheduled publish time (ISO instant)")
	cmd.Flags().String("condition", "", "Publish condition: scheduled or photo_required")
	cmd.Flags().StringArray("tag-handle", nil, "X handle to tag, without the @ (repeatable, max 10)")
}

func newSnsPostsCreateCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "create",
		Short: "Create a scheduled post draft",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			client := sns.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (json.RawMessage, error) {
				return client.CreatePost(cmd.Context(), token, postBody(cmd, true))
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	command.Flags().Int("chapter-id", 0, "Owning chapter id")
	addSnsPostFieldFlags(command)
	_ = command.MarkFlagRequired("chapter-id")
	_ = command.MarkFlagRequired("x-account-id")
	_ = command.MarkFlagRequired("text")
	_ = command.MarkFlagRequired("scheduled-at")
	_ = command.MarkFlagRequired("condition")
	return command
}

func newSnsPostsGetCommand(credentials store.CredentialStore) *cobra.Command {
	return &cobra.Command{
		Use:   "get POST_ID",
		Short: "Read a post and its ordered media",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := sns.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (json.RawMessage, error) {
				return client.GetPost(cmd.Context(), token, args[0])
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
}

func newSnsPostsUpdateCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "update POST_ID",
		Short: "Update a post draft",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			body := postBody(cmd, false)
			if len(body) == 0 {
				return fmt.Errorf("specify at least one field to update")
			}
			client := sns.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (json.RawMessage, error) {
				return client.UpdatePost(cmd.Context(), token, args[0], body)
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	addSnsPostFieldFlags(command)
	return command
}

func newSnsPostsDeleteCommand(credentials store.CredentialStore) *cobra.Command {
	return &cobra.Command{
		Use:   "delete POST_ID",
		Short: "Delete a post draft",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := sns.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (json.RawMessage, error) {
				return client.DeletePost(cmd.Context(), token, args[0])
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
}

func newSnsPostsPublishCommand(credentials store.CredentialStore) *cobra.Command {
	return &cobra.Command{
		Use:   "publish POST_ID",
		Short: "Publish a post to X now",
		Long: "Publish a post to X now.\n\n" +
			"Prints the terminal post the server returns. On an X-side failure the\n" +
			"server responds 502 with the persisted post (status failed or\n" +
			"needs_confirmation, failureReason set); that post is still printed and\n" +
			"the command then exits non-zero. On needs_confirmation, check X for the\n" +
			"prior attempt before explicitly re-invoking publish.",
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := sns.NewClient()
			result, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (sns.PublishResult, error) {
				return client.PublishPost(cmd.Context(), token, args[0])
			})
			if err != nil {
				return err
			}
			if err := printJSON(cmd, result.Body); err != nil {
				return err
			}
			if result.Status == http.StatusBadGateway {
				return fmt.Errorf("publish did not succeed: the X API call failed (HTTP 502); see failureReason in the post above")
			}
			return nil
		},
	}
}
