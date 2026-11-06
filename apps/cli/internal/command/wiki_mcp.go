package command

import (
	"errors"
	"os"
	"strings"

	"github.com/gdg-jp/gdgjp/cli/internal/wiki/mcp"
	"github.com/spf13/cobra"
)

// newWikiMCPCommand is `gdg wiki mcp`, the stdio MCP server the runner starts for Codex
// during an `answer` job. The token is the job's (asker-scoped, 10 minutes), from the env.
func newWikiMCPCommand() *cobra.Command {
	var spaces, urlLog string
	command := &cobra.Command{
		Use:    "mcp",
		Short:  "Serve wiki search / read_page as MCP tools over stdio (runner answer jobs)",
		Args:   cobra.NoArgs,
		Hidden: true,
		RunE: func(cmd *cobra.Command, _ []string) error {
			token := os.Getenv("GDG_WIKI_JOB_TOKEN")
			if token == "" {
				return errors.New("GDG_WIKI_JOB_TOKEN is required")
			}
			base := os.Getenv("GDG_WIKI_URL")
			if base == "" {
				base = "https://wiki.gdgs.jp"
			}
			server := &mcp.Server{BaseURL: base, Token: token, URLLog: urlLog}
			for _, space := range strings.Split(spaces, ",") {
				if space = strings.TrimSpace(space); space != "" {
					server.Spaces = append(server.Spaces, space)
				}
			}
			return server.Serve(cmd.Context(), cmd.InOrStdin(), cmd.OutOrStdout())
		},
	}
	command.Flags().StringVar(&spaces, "spaces", "", "Comma-separated space slugs this answer may read")
	command.Flags().StringVar(&urlLog, "url-log", "", "Append every returned URL to this file")
	return command
}
