package command

import (
	"errors"

	"github.com/gdg-jp/gdgjp/cli/internal/connpass"
	"github.com/gdg-jp/gdgjp/cli/internal/store"
	"github.com/spf13/cobra"
)

type eventFieldFlags struct {
	title                string
	subtitle             string
	description          string
	startAt              string
	endAt                string
	place                string
	address              string
	capacity             int
	eventType            string
	image                string
	ownerText            string
	reservedAt           string
	registrationEnabled  bool
	registrationOpenAt   string
	registrationCloseAt  string
	lotteryPublishDate   string
	allowConflictJoin    bool
	allowReceipt         bool
	invoiceNumber        string
	receiptIssuerName    string
	receiptIssuerAddress string
	paypalEmail          string
	contactDetails       string
	cancelPolicy         string
	participantOnlyInfo  string
}

func addEventFieldFlags(cmd *cobra.Command, flags *eventFieldFlags) {
	cmd.Flags().StringVar(&flags.title, "title", "", "Event title")
	cmd.Flags().StringVar(&flags.subtitle, "subtitle", "", "Event subtitle / catch")
	cmd.Flags().StringVar(&flags.description, "description", "", "Event description")
	cmd.Flags().StringVar(&flags.startAt, "start-at", "", "Event start datetime")
	cmd.Flags().StringVar(&flags.endAt, "end-at", "", "Event end datetime")
	cmd.Flags().StringVar(&flags.place, "place", "", "Venue name")
	cmd.Flags().StringVar(&flags.address, "address", "", "Venue address")
	cmd.Flags().IntVar(&flags.capacity, "capacity", 0, "Capacity")
	cmd.Flags().StringVar(&flags.eventType, "event-type", "", "Event type")
	cmd.Flags().StringVar(&flags.image, "image", "", "Event image URL or identifier")
	cmd.Flags().StringVar(&flags.ownerText, "owner-text", "", "Owner text")
	cmd.Flags().StringVar(&flags.reservedAt, "reserved-at", "", "Venue reserved-at datetime")
	cmd.Flags().BoolVar(&flags.registrationEnabled, "registration-enabled", false, "Whether registration is enabled")
	cmd.Flags().StringVar(&flags.registrationOpenAt, "registration-open-at", "", "Registration open datetime")
	cmd.Flags().StringVar(&flags.registrationCloseAt, "registration-close-at", "", "Registration close datetime")
	cmd.Flags().StringVar(&flags.lotteryPublishDate, "lottery-publish-date", "", "Lottery publish date")
	cmd.Flags().BoolVar(&flags.allowConflictJoin, "allow-conflict-join", false, "Allow joining conflicting events")
	cmd.Flags().BoolVar(&flags.allowReceipt, "allow-receipt", false, "Allow receipts")
	cmd.Flags().StringVar(&flags.invoiceNumber, "invoice-number", "", "Invoice number")
	cmd.Flags().StringVar(&flags.receiptIssuerName, "receipt-issuer-name", "", "Receipt issuer name")
	cmd.Flags().StringVar(&flags.receiptIssuerAddress, "receipt-issuer-address", "", "Receipt issuer address")
	cmd.Flags().StringVar(&flags.paypalEmail, "paypal-email", "", "PayPal email")
	cmd.Flags().StringVar(&flags.contactDetails, "contact-details", "", "Contact details")
	cmd.Flags().StringVar(&flags.cancelPolicy, "cancel-policy", "", "Cancel policy")
	cmd.Flags().StringVar(&flags.participantOnlyInfo, "participant-only-info", "", "Participant-only info")
}

func (flags *eventFieldFlags) apply(cmd *cobra.Command, body map[string]any) {
	setStringFlag(cmd, body, "title", "title", flags.title)
	setStringFlag(cmd, body, "subtitle", "subtitle", flags.subtitle)
	setStringFlag(cmd, body, "description", "description", flags.description)
	setStringFlag(cmd, body, "start-at", "startAt", flags.startAt)
	setStringFlag(cmd, body, "end-at", "endAt", flags.endAt)
	setStringFlag(cmd, body, "place", "place", flags.place)
	setStringFlag(cmd, body, "address", "address", flags.address)
	setIntFlag(cmd, body, "capacity", "capacity", flags.capacity)
	setStringFlag(cmd, body, "event-type", "eventType", flags.eventType)
	setStringFlag(cmd, body, "image", "image", flags.image)
	setStringFlag(cmd, body, "owner-text", "ownerText", flags.ownerText)
	setStringFlag(cmd, body, "reserved-at", "reservedAt", flags.reservedAt)
	setBoolFlag(cmd, body, "registration-enabled", "registrationEnabled", flags.registrationEnabled)
	setStringFlag(cmd, body, "registration-open-at", "registrationOpenAt", flags.registrationOpenAt)
	setStringFlag(cmd, body, "registration-close-at", "registrationCloseAt", flags.registrationCloseAt)
	setStringFlag(cmd, body, "lottery-publish-date", "lotteryPublishDate", flags.lotteryPublishDate)
	setBoolFlag(cmd, body, "allow-conflict-join", "allowConflictJoin", flags.allowConflictJoin)
	setBoolFlag(cmd, body, "allow-receipt", "allowReceipt", flags.allowReceipt)
	setStringFlag(cmd, body, "invoice-number", "invoiceNumber", flags.invoiceNumber)
	setStringFlag(cmd, body, "receipt-issuer-name", "receiptIssuerName", flags.receiptIssuerName)
	setStringFlag(cmd, body, "receipt-issuer-address", "receiptIssuerAddress", flags.receiptIssuerAddress)
	setStringFlag(cmd, body, "paypal-email", "paypalEmail", flags.paypalEmail)
	setStringFlag(cmd, body, "contact-details", "contactDetails", flags.contactDetails)
	setStringFlag(cmd, body, "cancel-policy", "cancelPolicy", flags.cancelPolicy)
	setStringFlag(cmd, body, "participant-only-info", "participantOnlyInfo", flags.participantOnlyInfo)
}

func newConnpassEventsCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "events",
		Short: "Manage connpass events",
	}
	command.AddCommand(newConnpassEventsListCommand(credentials))
	command.AddCommand(newConnpassEventsCreateCommand(credentials))
	command.AddCommand(newConnpassEventsGetCommand(credentials))
	command.AddCommand(newConnpassEventsUpdateCommand(credentials))
	command.AddCommand(newConnpassEventsPublishCommand(credentials))
	command.AddCommand(newConnpassSubEventsCommand(credentials))
	command.AddCommand(newConnpassSurveyCommand(credentials))
	command.AddCommand(newConnpassConferenceCommand(credentials))
	return command
}

func newConnpassEventsListCommand(credentials store.CredentialStore) *cobra.Command {
	return &cobra.Command{
		Use:   "list GROUP_ID",
		Short: "List events for an allowlisted group",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := connpass.NewClient()
			out, err := withConnpassToken(cmd.Context(), credentials, func(token string) (connpass.ListEventsResponse, error) {
				return client.ListEvents(cmd.Context(), token, args[0])
			})
			if err != nil {
				return err
			}
			return printConnpassJSON(cmd, out)
		},
	}
}

func newConnpassEventsCreateCommand(credentials store.CredentialStore) *cobra.Command {
	var fields eventFieldFlags
	create := &cobra.Command{
		Use:   "create GROUP_ID",
		Short: "Create an event draft (async job)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			body, err := mergeJSONBody(cmd)
			if err != nil {
				return err
			}
			fields.apply(cmd, body)
			title, _ := body["title"].(string)
			if title == "" {
				return errors.New("--title is required")
			}
			wait, _ := cmd.Flags().GetBool("wait")
			return runConnpassJob(cmd, credentials, wait, func(token string) (connpass.Job, error) {
				return connpass.NewClient().CreateEvent(cmd.Context(), token, args[0], body)
			})
		},
	}
	addEventFieldFlags(create, &fields)
	addJSONBodyFlags(create)
	addWaitFlag(create)
	return create
}

func newConnpassEventsGetCommand(credentials store.CredentialStore) *cobra.Command {
	return &cobra.Command{
		Use:   "get GROUP_ID EVENT_ID",
		Short: "Get a single event",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := connpass.NewClient()
			out, err := withConnpassToken(cmd.Context(), credentials, func(token string) (connpass.GetEventResponse, error) {
				return client.GetEvent(cmd.Context(), token, args[0], args[1])
			})
			if err != nil {
				return err
			}
			return printConnpassJSON(cmd, out)
		},
	}
}

func newConnpassEventsUpdateCommand(credentials store.CredentialStore) *cobra.Command {
	var fields eventFieldFlags
	update := &cobra.Command{
		Use:   "update GROUP_ID EVENT_ID",
		Short: "Update event fields (async job)",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			body, err := mergeJSONBody(cmd)
			if err != nil {
				return err
			}
			fields.apply(cmd, body)
			if len(body) == 0 {
				return errors.New("specify at least one field to update")
			}
			wait, _ := cmd.Flags().GetBool("wait")
			return runConnpassJob(cmd, credentials, wait, func(token string) (connpass.Job, error) {
				return connpass.NewClient().UpdateEvent(cmd.Context(), token, args[0], args[1], body)
			})
		},
	}
	addEventFieldFlags(update, &fields)
	addJSONBodyFlags(update)
	addWaitFlag(update)
	return update
}

func newConnpassEventsPublishCommand(credentials store.CredentialStore) *cobra.Command {
	var (
		postToTwitter bool
		comment       string
	)
	publish := &cobra.Command{
		Use:   "publish GROUP_ID EVENT_ID",
		Short: "Publish an event (async job)",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			body, err := mergeJSONBody(cmd)
			if err != nil {
				return err
			}
			setBoolFlag(cmd, body, "post-to-twitter", "postToTwitter", postToTwitter)
			setStringFlag(cmd, body, "comment", "comment", comment)
			wait, _ := cmd.Flags().GetBool("wait")
			return runConnpassJob(cmd, credentials, wait, func(token string) (connpass.Job, error) {
				return connpass.NewClient().PublishEvent(cmd.Context(), token, args[0], args[1], body)
			})
		},
	}
	publish.Flags().BoolVar(&postToTwitter, "post-to-twitter", false, "Also post to Twitter/X when publishing")
	publish.Flags().StringVar(&comment, "comment", "", "Publish comment")
	addJSONBodyFlags(publish)
	addWaitFlag(publish)
	return publish
}

func newConnpassSubEventsCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "sub-events",
		Short: "Manage sub-events linked to an event",
	}
	command.AddCommand(&cobra.Command{
		Use:   "list GROUP_ID EVENT_ID",
		Short: "List sub-events",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := connpass.NewClient()
			out, err := withConnpassToken(cmd.Context(), credentials, func(token string) (connpass.ListSubEventsResponse, error) {
				return client.ListSubEvents(cmd.Context(), token, args[0], args[1])
			})
			if err != nil {
				return err
			}
			return printConnpassJSON(cmd, out)
		},
	})

	var title string
	create := &cobra.Command{
		Use:   "create GROUP_ID EVENT_ID",
		Short: "Create a linked sub-event (async job)",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			body, err := mergeJSONBody(cmd)
			if err != nil {
				return err
			}
			setStringFlag(cmd, body, "title", "title", title)
			got, _ := body["title"].(string)
			if got == "" {
				return errors.New("--title is required")
			}
			wait, _ := cmd.Flags().GetBool("wait")
			return runConnpassJob(cmd, credentials, wait, func(token string) (connpass.Job, error) {
				return connpass.NewClient().CreateSubEvent(cmd.Context(), token, args[0], args[1], body)
			})
		},
	}
	create.Flags().StringVar(&title, "title", "", "Sub-event title")
	addJSONBodyFlags(create)
	addWaitFlag(create)
	command.AddCommand(create)

	command.AddCommand(&cobra.Command{
		Use:   "get GROUP_ID EVENT_ID SUB_EVENT_ID",
		Short: "Get a sub-event link",
		Args:  cobra.ExactArgs(3),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := connpass.NewClient()
			out, err := withConnpassToken(cmd.Context(), credentials, func(token string) (connpass.GetSubEventResponse, error) {
				return client.GetSubEvent(cmd.Context(), token, args[0], args[1], args[2])
			})
			if err != nil {
				return err
			}
			return printConnpassJSON(cmd, out)
		},
	})

	cancel := &cobra.Command{
		Use:   "cancel GROUP_ID EVENT_ID SUB_EVENT_ID",
		Short: "Cancel a sub-event (async job)",
		Args:  cobra.ExactArgs(3),
		RunE: func(cmd *cobra.Command, args []string) error {
			wait, _ := cmd.Flags().GetBool("wait")
			return runConnpassJob(cmd, credentials, wait, func(token string) (connpass.Job, error) {
				return connpass.NewClient().CancelSubEvent(cmd.Context(), token, args[0], args[1], args[2])
			})
		},
	}
	addWaitFlag(cancel)
	command.AddCommand(cancel)
	return command
}

func newConnpassSurveyCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "survey",
		Short: "Manage an event survey",
	}
	command.AddCommand(&cobra.Command{
		Use:   "get GROUP_ID EVENT_ID",
		Short: "Get an event survey",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := connpass.NewClient()
			out, err := withConnpassToken(cmd.Context(), credentials, func(token string) (connpass.GetSurveyResponse, error) {
				return client.GetSurvey(cmd.Context(), token, args[0], args[1])
			})
			if err != nil {
				return err
			}
			return printConnpassJSON(cmd, out)
		},
	})
	upsert := &cobra.Command{
		Use:   "upsert GROUP_ID EVENT_ID",
		Short: "Create or replace an event survey (async job)",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			if !jsonBodySpecified(cmd) {
				return errors.New("--from-file or --json is required")
			}
			body, err := mergeJSONBody(cmd)
			if err != nil {
				return err
			}
			wait, _ := cmd.Flags().GetBool("wait")
			return runConnpassJob(cmd, credentials, wait, func(token string) (connpass.Job, error) {
				return connpass.NewClient().UpsertSurvey(cmd.Context(), token, args[0], args[1], body)
			})
		},
	}
	addJSONBodyFlags(upsert)
	addWaitFlag(upsert)
	command.AddCommand(upsert)
	return command
}

func newConnpassConferenceCommand(credentials store.CredentialStore) *cobra.Command {
	command := &cobra.Command{
		Use:   "conference",
		Short: "Manage event conference info",
	}
	command.AddCommand(&cobra.Command{
		Use:   "get GROUP_ID EVENT_ID",
		Short: "Get conference info",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			client := connpass.NewClient()
			out, err := withConnpassToken(cmd.Context(), credentials, func(token string) (connpass.GetConferenceResponse, error) {
				return client.GetConference(cmd.Context(), token, args[0], args[1])
			})
			if err != nil {
				return err
			}
			return printConnpassJSON(cmd, out)
		},
	})

	var (
		isActive       bool
		lpURL          string
		cfpURL         string
		cfpStartAt     string
		cfpEndAt       string
		sponsorURL     string
		sponsorStartAt string
		sponsorEndAt   string
	)
	upsert := &cobra.Command{
		Use:   "upsert GROUP_ID EVENT_ID",
		Short: "Create or replace conference info (async job)",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			body, err := mergeJSONBody(cmd)
			if err != nil {
				return err
			}
			setBoolFlag(cmd, body, "is-active", "isActive", isActive)
			setStringFlag(cmd, body, "lp-url", "lpUrl", lpURL)
			setStringFlag(cmd, body, "cfp-url", "cfpUrl", cfpURL)
			setStringFlag(cmd, body, "cfp-start-at", "cfpStartAt", cfpStartAt)
			setStringFlag(cmd, body, "cfp-end-at", "cfpEndAt", cfpEndAt)
			setStringFlag(cmd, body, "sponsor-url", "sponsorUrl", sponsorURL)
			setStringFlag(cmd, body, "sponsor-start-at", "sponsorStartAt", sponsorStartAt)
			setStringFlag(cmd, body, "sponsor-end-at", "sponsorEndAt", sponsorEndAt)
			if _, ok := body["isActive"]; !ok {
				return errors.New("--is-active is required")
			}
			wait, _ := cmd.Flags().GetBool("wait")
			return runConnpassJob(cmd, credentials, wait, func(token string) (connpass.Job, error) {
				return connpass.NewClient().UpsertConference(cmd.Context(), token, args[0], args[1], body)
			})
		},
	}
	upsert.Flags().BoolVar(&isActive, "is-active", false, "Whether conference info is active")
	upsert.Flags().StringVar(&lpURL, "lp-url", "", "Landing page URL")
	upsert.Flags().StringVar(&cfpURL, "cfp-url", "", "CFP URL")
	upsert.Flags().StringVar(&cfpStartAt, "cfp-start-at", "", "CFP start datetime")
	upsert.Flags().StringVar(&cfpEndAt, "cfp-end-at", "", "CFP end datetime")
	upsert.Flags().StringVar(&sponsorURL, "sponsor-url", "", "Sponsor URL")
	upsert.Flags().StringVar(&sponsorStartAt, "sponsor-start-at", "", "Sponsor start datetime")
	upsert.Flags().StringVar(&sponsorEndAt, "sponsor-end-at", "", "Sponsor end datetime")
	addJSONBodyFlags(upsert)
	addWaitFlag(upsert)
	command.AddCommand(upsert)
	return command
}
