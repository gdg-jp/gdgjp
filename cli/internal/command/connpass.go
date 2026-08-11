package command

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/gdg-jp/gdgjp/cli/internal/connpass"
	"github.com/gdg-jp/gdgjp/cli/internal/oauth"
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
	return command
}

func withConnpassToken[T any](
	ctx context.Context,
	credentials store.CredentialStore,
	fn func(token string) (T, error),
) (T, error) {
	var zero T
	credential, err := credentials.Load()
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return zero, errors.New("not logged in; run gdg login")
		}
		return zero, err
	}
	result, err := fn(credential.AccessToken)
	if err == nil {
		return result, nil
	}
	var httpErr *connpass.HTTPError
	if !errors.As(err, &httpErr) || httpErr.StatusCode != 401 {
		return zero, err
	}
	fresh, refreshErr := oauth.Refresh(ctx, credential.RefreshToken)
	if refreshErr != nil {
		return zero, fmt.Errorf("refresh GDG Japan login: %w", refreshErr)
	}
	if saveErr := credentials.Save(fresh); saveErr != nil {
		return zero, saveErr
	}
	return fn(fresh.AccessToken)
}

func printConnpassJSON(cmd *cobra.Command, value any) error {
	enc := json.NewEncoder(cmd.OutOrStdout())
	enc.SetIndent("", "  ")
	return enc.Encode(value)
}

func newConnpassEventsCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "events",
		Short: "Manage connpass events",
	}

	var (
		title       string
		subtitle    string
		description string
		wait        bool
	)
	create := &cobra.Command{
		Use:   "create GROUP_ID",
		Short: "Create an event draft (async job)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if title == "" {
				return errors.New("--title is required")
			}
			client := connpass.NewClient()
			input := connpass.CreateEventInput{
				Title:       title,
				Subtitle:    subtitle,
				Description: description,
			}
			job, err := withConnpassToken(cmd.Context(), credentials, func(token string) (connpass.Job, error) {
				return client.CreateEvent(cmd.Context(), token, args[0], input)
			})
			if err != nil {
				return err
			}
			if wait {
				job, err = withConnpassToken(cmd.Context(), credentials, func(token string) (connpass.Job, error) {
					return client.WaitJob(cmd.Context(), token, job.ID, 2*time.Second)
				})
				if err != nil {
					return err
				}
			}
			return printConnpassJSON(cmd, job)
		},
	}
	create.Flags().StringVar(&title, "title", "", "Event title")
	create.Flags().StringVar(&subtitle, "subtitle", "", "Event subtitle / catch")
	create.Flags().StringVar(&description, "description", "", "Event description")
	create.Flags().BoolVar(&wait, "wait", false, "Wait for the async job to finish")
	command.AddCommand(create)

	publishWait := false
	publish := &cobra.Command{
		Use:   "publish GROUP_ID EVENT_ID",
		Short: "Publish an event (async job)",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := connpass.NewClient()
			job, err := withConnpassToken(cmd.Context(), credentials, func(token string) (connpass.Job, error) {
				return client.PublishEvent(cmd.Context(), token, args[0], args[1])
			})
			if err != nil {
				return err
			}
			if publishWait {
				job, err = withConnpassToken(cmd.Context(), credentials, func(token string) (connpass.Job, error) {
					return client.WaitJob(cmd.Context(), token, job.ID, 2*time.Second)
				})
				if err != nil {
					return err
				}
			}
			return printConnpassJSON(cmd, job)
		},
	}
	publish.Flags().BoolVar(&publishWait, "wait", false, "Wait for the async job to finish")
	command.AddCommand(publish)

	return command
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
			job, err := withConnpassToken(cmd.Context(), credentials, func(token string) (connpass.Job, error) {
				return client.GetJob(cmd.Context(), token, args[0])
			})
			if err != nil {
				return err
			}
			return printConnpassJSON(cmd, job)
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
			groups, err := withConnpassToken(cmd.Context(), credentials, func(token string) ([]connpass.Group, error) {
				return client.ListGroups(cmd.Context(), token)
			})
			if err != nil {
				return err
			}
			return printConnpassJSON(cmd, map[string]any{"groups": groups})
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
			input := connpass.UpsertGroupInput{
				ChapterID: chapterID,
				Enabled:   &enabled,
			}
			if cmd.Flags().Changed("numeric-group-id") {
				id := numericGroupID
				input.NumericGroupID = &id
			}
			group, err := withConnpassToken(cmd.Context(), credentials, func(token string) (connpass.Group, error) {
				return client.UpsertGroup(cmd.Context(), token, args[0], input)
			})
			if err != nil {
				return err
			}
			return printConnpassJSON(cmd, group)
		},
	}
	upsert.Flags().StringVar(&chapterID, "chapter-id", "", "GDG Accounts chapter id for organizer authorization")
	upsert.Flags().IntVar(&numericGroupID, "numeric-group-id", 0, "Numeric connpass group id")
	upsert.Flags().BoolVar(&enabled, "enabled", true, "Whether the group is enabled for automation")
	command.AddCommand(upsert)

	return command
}
