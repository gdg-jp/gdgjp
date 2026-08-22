package command

import (
	"errors"
	"net/http"

	"github.com/gdg-jp/gdgjp/cli/internal/connpass"
	"github.com/gdg-jp/gdgjp/cli/internal/store"
	"github.com/spf13/cobra"
)

func newConnpassEventOperationsCommand(credentials store.CredentialStore) *cobra.Command {
	operations := &cobra.Command{Use: "operations", Short: "Run event lifecycle and organizer operations"}
	for _, spec := range []struct{ use, suffix, method string }{
		{"copy GROUP_ID EVENT_ID", "copy", http.MethodPost},
		{"delete GROUP_ID EVENT_ID", "", http.MethodDelete},
		{"cancel GROUP_ID EVENT_ID", "cancel", http.MethodPost},
	} {
		spec := spec
		command := &cobra.Command{Use: spec.use, Args: cobra.ExactArgs(2), RunE: func(cmd *cobra.Command, args []string) error {
			wait, _ := cmd.Flags().GetBool("wait")
			return runConnpassJob(cmd, credentials, wait, func(token string) (connpass.Job, error) {
				return connpass.NewClient().StartEventAction(cmd.Context(), token, spec.method, args[0], args[1], spec.suffix, nil)
			})
		}}
		addWaitFlag(command)
		operations.AddCommand(command)
	}
	image := &cobra.Command{Use: "image GROUP_ID EVENT_ID FILE", Args: cobra.ExactArgs(3), RunE: func(cmd *cobra.Command, args []string) error {
		wait, _ := cmd.Flags().GetBool("wait")
		return runConnpassJob(cmd, credentials, wait, func(token string) (connpass.Job, error) {
			return connpass.NewClient().UploadEventImage(cmd.Context(), token, args[0], args[1], args[2])
		})
	}}
	addWaitFlag(image)
	operations.AddCommand(image)
	operations.AddCommand(newConnpassEventMessageCommand(credentials))
	operations.AddCommand(newConnpassEventReadCommand(credentials, "stats", "stats"))
	operations.AddCommand(newConnpassEventReadCommand(credentials, "participants", "participants"))
	operations.AddCommand(newConnpassEventReadCommand(credentials, "vouchers", "vouchers"))
	return operations
}

func newConnpassEventReadCommand(credentials store.CredentialStore, use, suffix string) *cobra.Command {
	return &cobra.Command{Use: use + " GROUP_ID EVENT_ID", Args: cobra.ExactArgs(2), RunE: func(cmd *cobra.Command, args []string) error {
		var output map[string]any
		_, err := withConnpassToken(cmd.Context(), credentials, func(token string) (struct{}, error) {
			return struct{}{}, connpass.NewClient().GetEventResource(cmd.Context(), token, args[0], args[1], suffix, &output)
		})
		if err != nil {
			return err
		}
		return printConnpassJSON(cmd, output)
	}}
}

func newConnpassEventMessageCommand(credentials store.CredentialStore) *cobra.Command {
	var subject, body string
	command := &cobra.Command{Use: "message GROUP_ID EVENT_ID", Args: cobra.ExactArgs(2), RunE: func(cmd *cobra.Command, args []string) error {
		if subject == "" || body == "" {
			return errors.New("--subject and --body are required")
		}
		wait, _ := cmd.Flags().GetBool("wait")
		return runConnpassJob(cmd, credentials, wait, func(token string) (connpass.Job, error) {
			return connpass.NewClient().StartEventAction(cmd.Context(), token, http.MethodPost, args[0], args[1], "messages", map[string]string{"subject": subject, "body": body})
		})
	}}
	command.Flags().StringVar(&subject, "subject", "", "Message subject")
	command.Flags().StringVar(&body, "body", "", "Message body")
	addWaitFlag(command)
	return command
}
