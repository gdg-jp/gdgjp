package command

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/gdg-jp/gdgjp/cli/internal/cliutil"
	"github.com/gdg-jp/gdgjp/cli/internal/connpass"
	"github.com/gdg-jp/gdgjp/cli/internal/store"
	"github.com/spf13/cobra"
)

func newConnpassCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "connpass",
		Short: "Automate connpass group event administration",
	}
	command.AddCommand(newConnpassEventsCommand(credentials))
	command.AddCommand(newConnpassJobsCommand(credentials))
	command.AddCommand(newConnpassGroupsCommand(credentials))
	command.AddCommand(newConnpassSessionCommand(credentials))
	return command
}

func addJSONBodyFlags(cmd *cobra.Command) {
	cmd.Flags().String("from-file", "", "JSON request body file (`-` for stdin)")
	cmd.Flags().String("json", "", "JSON request body")
	cmd.MarkFlagsMutuallyExclusive("from-file", "json")
}

func addWaitFlag(cmd *cobra.Command) *bool {
	wait := false
	cmd.Flags().BoolVar(&wait, "wait", false, "Wait for the async job to finish")
	return &wait
}

func mergeJSONBody(cmd *cobra.Command) (map[string]any, error) {
	fromFile, err := cmd.Flags().GetString("from-file")
	if err != nil {
		return nil, err
	}
	rawJSON, err := cmd.Flags().GetString("json")
	if err != nil {
		return nil, err
	}
	if fromFile == "" && rawJSON == "" {
		return map[string]any{}, nil
	}
	var data []byte
	if fromFile != "" {
		if fromFile == "-" {
			data, err = io.ReadAll(cmd.InOrStdin())
		} else {
			data, err = os.ReadFile(fromFile)
		}
		if err != nil {
			return nil, err
		}
	} else {
		data = []byte(rawJSON)
	}
	var body map[string]any
	if err := json.Unmarshal(data, &body); err != nil {
		return nil, fmt.Errorf("parse JSON body: %w", err)
	}
	if body == nil {
		return map[string]any{}, nil
	}
	return body, nil
}

func jsonBodySpecified(cmd *cobra.Command) bool {
	fromFile, _ := cmd.Flags().GetString("from-file")
	rawJSON, _ := cmd.Flags().GetString("json")
	return fromFile != "" || rawJSON != ""
}

func runConnpassJob(
	cmd *cobra.Command,
	credentials store.CredentialStore,
	wait bool,
	start func(token string) (connpass.Job, error),
) error {
	client := connpass.NewClient()
	job, err := cliutil.WithToken(cmd.Context(), credentials, start)
	if err != nil {
		return err
	}
	if wait {
		job, err = cliutil.WithToken(cmd.Context(), credentials, func(token string) (connpass.Job, error) {
			return client.WaitJob(cmd.Context(), token, job.Id, 2*time.Second)
		})
		if err != nil {
			return err
		}
		if fail := connpass.JobFailed(job); fail != nil {
			return fail
		}
	}
	return cliutil.PrintJSON(cmd.OutOrStdout(), job)
}

func setStringFlag(cmd *cobra.Command, body map[string]any, name, jsonKey, value string) {
	if cmd.Flags().Changed(name) {
		body[jsonKey] = value
	}
}

func setBoolFlag(cmd *cobra.Command, body map[string]any, name, jsonKey string, value bool) {
	if cmd.Flags().Changed(name) {
		body[jsonKey] = value
	}
}

func setIntFlag(cmd *cobra.Command, body map[string]any, name, jsonKey string, value int) {
	if cmd.Flags().Changed(name) {
		body[jsonKey] = value
	}
}

func newConnpassJobsCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "jobs",
		Short: "Inspect async jobs",
	}
	command.AddCommand(&cobra.Command{
		Use:   "get JOB_ID",
		Short: "Get job status",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := connpass.NewClient()
			job, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (connpass.Job, error) {
				return client.GetJob(cmd.Context(), token, args[0])
			})
			if err != nil {
				return err
			}
			return cliutil.PrintJSON(cmd.OutOrStdout(), job)
		},
	})
	command.AddCommand(&cobra.Command{
		Use:   "wait JOB_ID",
		Short: "Wait until a job succeeds or fails",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := connpass.NewClient()
			job, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (connpass.Job, error) {
				return client.WaitJob(cmd.Context(), token, args[0], 2*time.Second)
			})
			if err != nil {
				return err
			}
			if fail := connpass.JobFailed(job); fail != nil {
				return fail
			}
			return cliutil.PrintJSON(cmd.OutOrStdout(), job)
		},
	})
	return command
}

func newConnpassGroupsCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "groups",
		Short: "Manage allowlisted connpass groups (admin)",
	}

	command.AddCommand(&cobra.Command{
		Use:   "list",
		Short: "List allowlisted groups",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			client := connpass.NewClient()
			groups, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) ([]connpass.Group, error) {
				return client.ListGroups(cmd.Context(), token)
			})
			if err != nil {
				return err
			}
			return cliutil.PrintJSON(cmd.OutOrStdout(), map[string]any{"groups": groups})
		},
	})

	var (
		chapterID      string
		numericGroupID int
		enabled        bool
	)
	upsert := &cobra.Command{
		Use:   "upsert GROUP_ID",
		Short: "Register or update an allowlisted group",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := connpass.NewClient()
			input := connpass.UpsertGroupRequest{
				Enabled: &enabled,
			}
			if cmd.Flags().Changed("chapter-id") {
				input.ChapterId = &chapterID
			}
			if cmd.Flags().Changed("numeric-group-id") {
				id := numericGroupID
				input.NumericGroupId = &id
			}
			group, err := cliutil.WithToken(cmd.Context(), credentials, func(token string) (connpass.Group, error) {
				return client.UpsertGroup(cmd.Context(), token, args[0], input)
			})
			if err != nil {
				return err
			}
			return cliutil.PrintJSON(cmd.OutOrStdout(), group)
		},
	}
	upsert.Flags().StringVar(&chapterID, "chapter-id", "", "GDG Accounts chapter id for organizer authorization")
	upsert.Flags().IntVar(&numericGroupID, "numeric-group-id", 0, "Numeric connpass group id")
	upsert.Flags().BoolVar(&enabled, "enabled", true, "Whether the group is enabled for automation")
	command.AddCommand(upsert)

	return command
}

func newConnpassSessionCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "session",
		Short: "Manage the shared connpass bot session (admin)",
	}
	relogin := &cobra.Command{
		Use:   "relogin",
		Short: "Force bot account re-login (async job)",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			wait, _ := cmd.Flags().GetBool("wait")
			return runConnpassJob(cmd, credentials, wait, func(token string) (connpass.Job, error) {
				return connpass.NewClient().Relogin(cmd.Context(), token)
			})
		},
	}
	addWaitFlag(relogin)
	command.AddCommand(relogin)
	return command
}
