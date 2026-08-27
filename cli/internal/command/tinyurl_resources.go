package command

import (
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/gdg-jp/gdgjp/cli/internal/cliutil"
	"github.com/gdg-jp/gdgjp/cli/internal/store"
	"github.com/gdg-jp/gdgjp/cli/internal/tinyurl"
	"github.com/spf13/cobra"
)

// tinyurlIDArg parses a numeric path argument, e.g. TAG_ID or FOLDER_ID.
func tinyurlIDArg(label, raw string) (int, error) {
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer, got %q", label, raw)
	}
	return value, nil
}

// --- tags ----------------------------------------------------------------

func newTinyurlTagsCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "tags",
		Short: "Manage personal tags",
	}
	command.AddCommand(newTinyurlTagsListCommand(credentials))
	command.AddCommand(newTinyurlTagsCreateCommand(credentials))
	command.AddCommand(newTinyurlTagsUpdateCommand(credentials))
	command.AddCommand(newTinyurlTagsDeleteCommand(credentials))
	return command
}

func newTinyurlTagsListCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "list",
		Short: "List tags visible to the caller",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (json.RawMessage, error) {
				return client.ListTags(cmd.Context(), token, tinyurlPage(cmd))
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	addTinyurlPageFlags(command)
	return command
}

func tagBody(cmd *cobra.Command) map[string]any {
	body := map[string]any{}
	name, _ := cmd.Flags().GetString("name")
	body["name"] = name
	if cmd.Flags().Changed("color") {
		color, _ := cmd.Flags().GetString("color")
		body["color"] = color
	}
	return body
}

func newTinyurlTagsCreateCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "create",
		Short: "Create a personal tag",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (json.RawMessage, error) {
				return client.CreateTag(cmd.Context(), token, tagBody(cmd))
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	command.Flags().String("name", "", "Tag name")
	command.Flags().String("color", "", "Tag color")
	_ = command.MarkFlagRequired("name")
	return command
}

func newTinyurlTagsUpdateCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "update TAG_ID",
		Short: "Rename or recolor a personal tag",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := tinyurlIDArg("TAG_ID", args[0])
			if err != nil {
				return err
			}
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (json.RawMessage, error) {
				return client.UpdateTag(cmd.Context(), token, id, tagBody(cmd))
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	command.Flags().String("name", "", "Tag name")
	command.Flags().String("color", "", "Tag color")
	_ = command.MarkFlagRequired("name")
	return command
}

func newTinyurlTagsDeleteCommand(credentials store.CredentialStore) *cobra.Command {
	return &cobra.Command{
		Use:   "delete TAG_ID",
		Short: "Delete a personal tag",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := tinyurlIDArg("TAG_ID", args[0])
			if err != nil {
				return err
			}
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (json.RawMessage, error) {
				return client.DeleteTag(cmd.Context(), token, id)
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
}

// --- folders -------------------------------------------------------------

func newTinyurlFoldersCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "folders",
		Short: "Manage link folders",
	}
	command.AddCommand(newTinyurlFoldersListCommand(credentials))
	command.AddCommand(newTinyurlFoldersGetCommand(credentials))
	command.AddCommand(newTinyurlFoldersCreateCommand(credentials))
	command.AddCommand(newTinyurlFoldersUpdateCommand(credentials))
	command.AddCommand(newTinyurlFoldersDeleteCommand(credentials))
	return command
}

func newTinyurlFoldersListCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "list",
		Short: "List accessible folders",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (json.RawMessage, error) {
				return client.ListFolders(cmd.Context(), token, tinyurlPage(cmd))
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	addTinyurlPageFlags(command)
	return command
}

func newTinyurlFoldersGetCommand(credentials store.CredentialStore) *cobra.Command {
	return &cobra.Command{
		Use:   "get FOLDER_ID",
		Short: "Get an accessible folder",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := tinyurlIDArg("FOLDER_ID", args[0])
			if err != nil {
				return err
			}
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (json.RawMessage, error) {
				return client.GetFolder(cmd.Context(), token, id)
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
}

func newTinyurlFoldersCreateCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "create",
		Short: "Create a folder",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			body := map[string]any{}
			name, _ := cmd.Flags().GetString("name")
			body["name"] = name
			if cmd.Flags().Changed("parent-id") {
				parentID, _ := cmd.Flags().GetInt("parent-id")
				body["parentFolderId"] = parentID
			}
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (json.RawMessage, error) {
				return client.CreateFolder(cmd.Context(), token, body)
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	command.Flags().String("name", "", "Folder name")
	command.Flags().Int("parent-id", 0, "Parent folder id")
	_ = command.MarkFlagRequired("name")
	return command
}

func newTinyurlFoldersUpdateCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "update FOLDER_ID",
		Short: "Rename a folder",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := tinyurlIDArg("FOLDER_ID", args[0])
			if err != nil {
				return err
			}
			name, _ := cmd.Flags().GetString("name")
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (json.RawMessage, error) {
				return client.UpdateFolder(cmd.Context(), token, id, map[string]any{"name": name})
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
	command.Flags().String("name", "", "New folder name")
	_ = command.MarkFlagRequired("name")
	return command
}

func newTinyurlFoldersDeleteCommand(credentials store.CredentialStore) *cobra.Command {
	return &cobra.Command{
		Use:   "delete FOLDER_ID",
		Short: "Delete an empty folder",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := tinyurlIDArg("FOLDER_ID", args[0])
			if err != nil {
				return err
			}
			client := tinyurl.NewClient()
			out, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (json.RawMessage, error) {
				return client.DeleteFolder(cmd.Context(), token, id)
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, out)
		},
	}
}

// --- jobs --------------------------------------------------------------------

func newTinyurlJobsCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "jobs",
		Short: "Inspect async domain provisioning jobs",
	}
	command.AddCommand(&cobra.Command{
		Use:   "get JOB_ID",
		Short: "Get job status",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := tinyurl.NewClient()
			job, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (tinyurl.Job, error) {
				return client.GetJob(cmd.Context(), token, args[0])
			})
			if err != nil {
				return err
			}
			return printJSON(cmd, job)
		},
	})
	command.AddCommand(&cobra.Command{
		Use:   "wait JOB_ID",
		Short: "Wait until a job succeeds or fails",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := tinyurl.NewClient()
			job, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (tinyurl.Job, error) {
				return client.WaitJob(cmd.Context(), token, args[0], 2*time.Second)
			})
			if err != nil {
				return err
			}
			if fail := tinyurl.JobFailed(job); fail != nil {
				return fail
			}
			return printJSON(cmd, job)
		},
	})
	return command
}
