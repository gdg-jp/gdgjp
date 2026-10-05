package command

import (
	"fmt"
	"strconv"

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
	command.AddCommand(newImgSlugCommand(credentials))
	command.AddCommand(newImgMoveCommand(credentials))
	command.AddCommand(newImgShareCommand(credentials))
	command.AddCommand(newImgDeleteCommand(credentials))
	command.AddCommand(newImgFoldersCommand(credentials))
	return command
}

func newImgListCommand(credentials store.CredentialStore) *cobra.Command {
	var chapterID int
	var folderID string
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
			if cmd.Flags().Changed("folder-id") {
				options.FolderID = &folderID
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
	command.Flags().StringVar(&folderID, "folder-id", "", `Filter by folder ID, or "unfiled" for images with no folder`)
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

func newImgSlugCommand(credentials store.CredentialStore) *cobra.Command {
	var clear bool
	command := &cobra.Command{
		Use:   "slug IMAGE_ID [SLUG]",
		Short: "Set or clear an image's custom slug",
		Args:  cobra.RangeArgs(1, 2),
		RunE: func(cmd *cobra.Command, args []string) error {
			var slug *string
			switch {
			case clear:
				if len(args) == 2 {
					return fmt.Errorf("pass either a SLUG or --clear, not both")
				}
			case len(args) == 2:
				slug = &args[1]
			default:
				return fmt.Errorf("provide a SLUG argument or --clear")
			}
			client := img.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (img.CliImageResponse, error) {
				return client.SetSlug(cmd.Context(), token, args[0], slug)
			})
			if err != nil {
				return err
			}
			return cliutil.PrintJSON(cmd.OutOrStdout(), out)
		},
	}
	command.Flags().BoolVar(&clear, "clear", false, "Remove the image's custom slug")
	return command
}

func newImgMoveCommand(credentials store.CredentialStore) *cobra.Command {
	var folderID int
	var clear bool
	command := &cobra.Command{
		Use:   "move IMAGE_ID",
		Short: "Assign an image to a folder, or unfile it",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			var folderIDPtr *int
			switch {
			case clear && cmd.Flags().Changed("folder-id"):
				return fmt.Errorf("pass either --folder-id or --clear, not both")
			case clear:
			case cmd.Flags().Changed("folder-id"):
				folderIDPtr = &folderID
			default:
				return fmt.Errorf("provide --folder-id or --clear")
			}
			client := img.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (img.CliImageResponse, error) {
				return client.Move(cmd.Context(), token, args[0], folderIDPtr)
			})
			if err != nil {
				return err
			}
			return cliutil.PrintJSON(cmd.OutOrStdout(), out)
		},
	}
	command.Flags().IntVar(&folderID, "folder-id", 0, "Folder to file the image into")
	command.Flags().BoolVar(&clear, "clear", false, "Unfile the image")
	return command
}

func newImgShareCommand(credentials store.CredentialStore) *cobra.Command {
	var chapterID int
	command := &cobra.Command{
		Use:   "share IMAGE_ID",
		Short: "Re-share an image with a different chapter you belong to",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := img.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (img.CliImageResponse, error) {
				return client.Share(cmd.Context(), token, args[0], chapterID)
			})
			if err != nil {
				return err
			}
			return cliutil.PrintJSON(cmd.OutOrStdout(), out)
		},
	}
	command.Flags().IntVar(&chapterID, "chapter-id", 0, "Chapter to share the image with")
	_ = command.MarkFlagRequired("chapter-id")
	return command
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

// --- folders -------------------------------------------------------------

func newImgFoldersCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "folders",
		Short: "Manage image folders",
	}
	command.AddCommand(newImgFoldersListCommand(credentials))
	command.AddCommand(newImgFoldersGetCommand(credentials))
	command.AddCommand(newImgFoldersCreateCommand(credentials))
	command.AddCommand(newImgFoldersUpdateCommand(credentials))
	command.AddCommand(newImgFoldersDeleteCommand(credentials))
	return command
}

func newImgFoldersListCommand(credentials store.CredentialStore) *cobra.Command {
	var chapterID int
	var limit int
	var cursor string
	command := &cobra.Command{
		Use:   "list",
		Short: "List the caller's folders, optionally narrowed to one chapter",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			options := img.ListFoldersOptions{}
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
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (img.FolderList, error) {
				return client.ListFolders(cmd.Context(), token, options)
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

func newImgFoldersGetCommand(credentials store.CredentialStore) *cobra.Command {
	return &cobra.Command{
		Use:   "get FOLDER_ID",
		Short: "Get a folder",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := imgFolderIDArg(args[0])
			if err != nil {
				return err
			}
			client := img.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (img.FolderResponse, error) {
				return client.GetFolder(cmd.Context(), token, id)
			})
			if err != nil {
				return err
			}
			return cliutil.PrintJSON(cmd.OutOrStdout(), out)
		},
	}
}

func newImgFoldersCreateCommand(credentials store.CredentialStore) *cobra.Command {
	var chapterID int
	command := &cobra.Command{
		Use:   "create",
		Short: "Create a folder in one of the caller's chapters",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			name, _ := cmd.Flags().GetString("name")
			var chapterIDPtr *int
			if cmd.Flags().Changed("chapter-id") {
				chapterIDPtr = &chapterID
			}
			client := img.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (img.FolderResponse, error) {
				return client.CreateFolder(cmd.Context(), token, name, chapterIDPtr)
			})
			if err != nil {
				return err
			}
			return cliutil.PrintJSON(cmd.OutOrStdout(), out)
		},
	}
	command.Flags().String("name", "", "Folder name")
	command.Flags().IntVar(&chapterID, "chapter-id", 0, "Chapter ID (required when the caller belongs to more than one chapter)")
	_ = command.MarkFlagRequired("name")
	return command
}

func newImgFoldersUpdateCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "update FOLDER_ID",
		Short: "Rename a folder",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := imgFolderIDArg(args[0])
			if err != nil {
				return err
			}
			name, _ := cmd.Flags().GetString("name")
			client := img.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (img.FolderResponse, error) {
				return client.UpdateFolder(cmd.Context(), token, id, name)
			})
			if err != nil {
				return err
			}
			return cliutil.PrintJSON(cmd.OutOrStdout(), out)
		},
	}
	command.Flags().String("name", "", "New folder name")
	_ = command.MarkFlagRequired("name")
	return command
}

func newImgFoldersDeleteCommand(credentials store.CredentialStore) *cobra.Command {
	return &cobra.Command{
		Use:   "delete FOLDER_ID",
		Short: "Delete a folder; its images fall back to unfiled",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := imgFolderIDArg(args[0])
			if err != nil {
				return err
			}
			client := img.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (img.FolderDeleteResult, error) {
				return client.DeleteFolder(cmd.Context(), token, id)
			})
			if err != nil {
				return err
			}
			return cliutil.PrintJSON(cmd.OutOrStdout(), out)
		},
	}
}

func imgFolderIDArg(raw string) (int, error) {
	id, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("FOLDER_ID must be an integer: %w", err)
	}
	return id, nil
}
