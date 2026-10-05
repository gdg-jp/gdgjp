package command

import (
	"encoding/json"

	"github.com/gdg-jp/gdgjp/cli/internal/cliutil"
	"github.com/gdg-jp/gdgjp/cli/internal/sns"
	"github.com/gdg-jp/gdgjp/cli/internal/store"
	"github.com/spf13/cobra"
)

func newSnsMediaCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "media",
		Short: "Attach and remove post images",
	}
	command.AddCommand(newSnsMediaAddCommand(credentials))
	command.AddCommand(newSnsMediaDeleteCommand(credentials))
	return command
}

func newSnsMediaAddCommand(credentials store.CredentialStore) *cobra.Command {
	var sortOrder int
	var altText string
	command := &cobra.Command{
		Use:   "add POST_ID FILE",
		Short: "Attach an image to a post draft",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			var altPtr *string
			if cmd.Flags().Changed("alt") {
				altPtr = &altText
			}
			client := sns.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (json.RawMessage, error) {
				return client.AddMedia(cmd.Context(), token, args[0], args[1], sortOrder, altPtr)
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	command.Flags().IntVar(&sortOrder, "sort-order", 0, "Zero-based position of this image within the post")
	command.Flags().StringVar(&altText, "alt", "", "Alt text for the image")
	_ = command.MarkFlagRequired("sort-order")
	return command
}

func newSnsMediaDeleteCommand(credentials store.CredentialStore) *cobra.Command {
	return &cobra.Command{
		Use:   "delete MEDIA_ID",
		Short: "Remove an image from its post",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := sns.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (json.RawMessage, error) {
				return client.DeleteMedia(cmd.Context(), token, args[0])
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
}
