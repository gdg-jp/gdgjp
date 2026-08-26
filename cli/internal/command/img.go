package command

import (
	"github.com/gdg-jp/gdgjp/cli/internal/cliutil"
	"github.com/gdg-jp/gdgjp/cli/internal/img"
	"github.com/gdg-jp/gdgjp/cli/internal/store"
	"github.com/spf13/cobra"
)

func newImgCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "img",
		Short: "Manage images hosted on img.gdgs.jp",
	}
	command.AddCommand(newImgListCommand(credentials))
	command.AddCommand(newImgGetCommand(credentials))
	command.AddCommand(newImgUploadCommand(credentials))
	command.AddCommand(newImgReplaceCommand(credentials))
	command.AddCommand(newImgMobileCommand(credentials))
	command.AddCommand(newImgDeleteCommand(credentials))
	return command
}

func newImgListCommand(credentials store.CredentialStore) *cobra.Command {
	var chapterID int
	var limit int
	var cursor string
	command := &cobra.Command{
		Use:   "list",
		Short: "List the caller's images",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			options := img.ListOptions{}
			if cmd.Flags().Changed("chapter-id") {
				options.ChapterID = &chapterID
			}
			if cmd.Flags().Changed("limit") {
				options.Limit = &limit
			}
			if cmd.Flags().Changed("cursor") {
				options.Cursor = &cursor
			}
			client := img.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (img.CliImageList, error) {
				return client.List(cmd.Context(), token, options)
			})
			if err != nil {
				return err
			}
			return cliutil.PrintJSON(cmd.OutOrStdout(), out)
		},
	}
	command.Flags().IntVar(&chapterID, "chapter-id", 0, "Filter by chapter ID")
	command.Flags().IntVar(&limit, "limit", 0, "Maximum number of results")
	command.Flags().StringVar(&cursor, "cursor", "", "Pagination cursor")
	return command
}

func newImgGetCommand(credentials store.CredentialStore) *cobra.Command {
	return &cobra.Command{
		Use:   "get IMAGE_ID",
		Short: "Get image management metadata",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := img.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (img.CliImageResponse, error) {
				return client.Get(cmd.Context(), token, args[0])
			})
			if err != nil {
				return err
			}
			return cliutil.PrintJSON(cmd.OutOrStdout(), out)
		},
	}
}

func newImgUploadCommand(credentials store.CredentialStore) *cobra.Command {
	var chapterID int
	command := &cobra.Command{
		Use:   "upload FILE",
		Short: "Upload a new image",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			var chapterIDPtr *int
			if cmd.Flags().Changed("chapter-id") {
				chapterIDPtr = &chapterID
			}
			client := img.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (img.UploadResult, error) {
				return client.Upload(cmd.Context(), token, args[0], chapterIDPtr)
			})
			if err != nil {
				return err
			}
			return cliutil.PrintJSON(cmd.OutOrStdout(), out)
		},
	}
	command.Flags().IntVar(&chapterID, "chapter-id", 0, "Chapter ID (required when the caller belongs to more than one chapter)")
	return command
}

func newImgReplaceCommand(credentials store.CredentialStore) *cobra.Command {
	return &cobra.Command{
		Use:   "replace IMAGE_ID FILE",
		Short: "Replace an existing image, keeping its public URL stable",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := img.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (img.CliReplaceResult, error) {
				return client.Replace(cmd.Context(), token, args[0], args[1])
			})
			if err != nil {
				return err
			}
			return cliutil.PrintJSON(cmd.OutOrStdout(), out)
		},
	}
}

func newImgMobileCommand(credentials store.CredentialStore) *cobra.Command {
	return &cobra.Command{
		Use:   "mobile IMAGE_ID FILE",
		Short: "Upload a mobile-optimized variant of an existing image",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := img.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (img.CliMobileResult, error) {
				return client.UploadMobile(cmd.Context(), token, args[0], args[1])
			})
			if err != nil {
				return err
			}
			return cliutil.PrintJSON(cmd.OutOrStdout(), out)
		},
	}
}

func newImgDeleteCommand(credentials store.CredentialStore) *cobra.Command {
	return &cobra.Command{
		Use:   "delete IMAGE_ID",
		Short: "Delete an image",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := img.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (img.CliDeleteResult, error) {
				return client.Delete(cmd.Context(), token, args[0])
			})
			if err != nil {
				return err
			}
			return cliutil.PrintJSON(cmd.OutOrStdout(), out)
		},
	}
}
