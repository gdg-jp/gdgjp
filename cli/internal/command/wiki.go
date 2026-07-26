package command

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/gdg-jp/gdgjp/cli/internal/oauth"
	"github.com/gdg-jp/gdgjp/cli/internal/store"
	wikiapi "github.com/gdg-jp/gdgjp/cli/internal/wiki"
	"github.com/spf13/cobra"
)

type wikiService struct {
	credentials store.CredentialStore
	client      *wikiapi.Client
}

func newWikiCommand(credentials store.CredentialStore) *cobra.Command {
	return newWikiCommandWithService(&wikiService{credentials: credentials, client: wikiapi.NewClient()})
}
func newWikiCommandWithService(service *wikiService) *cobra.Command {
	command := &cobra.Command{Use: "wiki", Short: "Clone and synchronize Wiki pages"}
	command.AddCommand(&cobra.Command{Use: "clone DIRECTORY", Args: cobra.ExactArgs(1), Short: "Clone visible Wiki pages into Markdown files", RunE: func(cmd *cobra.Command, args []string) error { return service.clone(cmd, args[0]) }})
	var resolve bool
	sync := &cobra.Command{Use: "sync DIRECTORY", Args: cobra.ExactArgs(1), Short: "Synchronize local Wiki Markdown changes", RunE: func(cmd *cobra.Command, args []string) error { return service.sync(cmd, args[0], resolve) }}
	sync.Flags().BoolVar(&resolve, "resolve", false, "apply files after resolving conflict markers")
	command.AddCommand(sync)
	return command
}
func (s *wikiService) withToken(cmd *cobra.Command, op func(string) error) error {
	creds, err := s.credentials.Load()
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return errors.New("not logged in; run gdg login")
		}
		return err
	}
	err = op(creds.AccessToken)
	var httpErr *wikiapi.HTTPError
	if !errors.As(err, &httpErr) || httpErr.StatusCode != 401 {
		return err
	}
	fresh, err := oauth.Refresh(cmd.Context(), creds.RefreshToken)
	if err != nil {
		return fmt.Errorf("refresh GDG Japan login: %w", err)
	}
	if err = s.credentials.Save(fresh); err != nil {
		return fmt.Errorf("save refreshed credentials: %w", err)
	}
	return op(fresh.AccessToken)
}
func (s *wikiService) clone(cmd *cobra.Command, root string) error {
	return s.withToken(cmd, func(token string) error {
		snapshot, err := s.client.Snapshot(cmd.Context(), token)
		if err != nil {
			return err
		}
		byID := map[string]wikiapi.Page{}
		for _, p := range snapshot.Pages {
			byID[p.ID] = p
		}
		state := wikiapi.State{Version: 1, Pages: map[string]wikiapi.StatePage{}}
		for _, p := range snapshot.Pages {
			if p.PageType != nil && *p.PageType == "task-list" {
				continue
			}
			saved, err := wikiapi.WritePage(root, p, byID, token, s.client)
			if err != nil {
				return err
			}
			state.Pages[p.ID] = saved
		}
		if err := wikiapi.SaveState(root, state); err != nil {
			return err
		}
		_, err = fmt.Fprintf(cmd.OutOrStdout(), "Cloned %d Wiki pages into %s\n", len(state.Pages), root)
		return err
	})
}
func hasConflict(s string) bool {
	return strings.Contains(s, "<<<<<<< LOCAL") || strings.Contains(s, "=======") && strings.Contains(s, ">>>>>>> WIKI")
}
func (s *wikiService) sync(cmd *cobra.Command, root string, resolve bool) error {
	return s.withToken(cmd, func(token string) error {
		state, err := wikiapi.LoadState(root)
		if err != nil {
			return err
		}
		markers, err := wikiapi.ConflictFiles(root)
		if err != nil {
			return err
		}
		if len(markers) > 0 {
			return fmt.Errorf("unresolved Wiki conflict markers in %s; edit the files, remove markers, then run sync --resolve", strings.Join(markers, ", "))
		}
		local, err := wikiapi.LocalPages(root)
		if err != nil {
			return err
		}
		remote, err := s.client.Snapshot(cmd.Context(), token)
		if err != nil {
			return err
		}
		byID := map[string]wikiapi.Page{}
		for _, p := range remote.Pages {
			byID[p.ID] = p
		}
		_ = resolve // the flag documents that a marker-free resolved tree is intentional.
		// Detect remote divergence before emitting any write. A conflict is intentionally
		// whole-file: it is unambiguous for YAML front matter as well as Markdown.
		conflicted := false
		for id, base := range state.Pages {
			l, exists := local[id]
			p, remoteExists := byID[id]
			if !exists || !remoteExists || p.Revision == base.Revision {
				continue
			}
			jaRaw, _ := os.ReadFile(filepath.Join(l.Dir, "ja.md"))
			enRaw, _ := os.ReadFile(filepath.Join(l.Dir, "en.md"))
			if string(jaRaw) != base.JA || string(enRaw) != base.EN {
				if err := wikiapi.WriteConflict(l.Dir, base.JA, string(jaRaw), wikiapi.RenderRemote(p, "ja"), base.EN, string(enRaw), wikiapi.RenderRemote(p, "en")); err != nil {
					return err
				}
				conflicted = true
			}
		}
		if conflicted {
			return errors.New("Wiki changed remotely; conflict markers were written and no changes were applied")
		}
		operations := make([]wikiapi.SyncOperation, 0, len(local)+len(state.Pages))
		deferredChildren := false
		for id, l := range local {
			p, err := wikiapi.PageFromLocal(l, local)
			if err != nil {
				if errors.Is(err, wikiapi.ErrParentNotCreated) {
					deferredChildren = true
					continue
				}
				return err
			}
			if id != "" {
				if base, ok := state.Pages[id]; ok {
					p.Revision = base.Revision
				}
				if old, ok := byID[id]; ok {
					p.ID = old.ID
				}
			}
			if p.PageType != nil && *p.PageType == "task-list" {
				return fmt.Errorf("%s: task-list pages cannot be synchronized", l.Rel)
			}
			operations = append(operations, wikiapi.SyncOperation{Kind: "upsert", ExpectedRevision: p.Revision, Page: &p})
		}
		// Archives are last: a nested child may be waiting for a newly-created
		// parent, and we never archive anything until all parent-first upserts
		// have become addressable by their server IDs.
		if !deferredChildren {
			for id, base := range state.Pages {
				if _, ok := local[id]; !ok {
					operations = append(operations, wikiapi.SyncOperation{Kind: "archive", ID: id, ExpectedRevision: base.Revision})
				}
			}
		}
		if len(operations) == 0 {
			return nil
		}
		result, err := s.client.Sync(cmd.Context(), token, wikiapi.SyncRequest{Operations: operations})
		if err != nil {
			return err
		}
		// Sync allocates attachment IDs transactionally. Upload only after that
		// succeeds, then fetch a canonical snapshot for state and normalized files.
		for _, returned := range result.Pages {
			l, ok := local[returned.ID]
			if !ok {
				for _, candidate := range local {
					if candidate.Slug() == returned.Slug {
						l, ok = candidate, true
						break
					}
				}
			}
			if !ok {
				continue
			}
			for _, attachment := range l.Attachments() {
				attachmentID := attachment.ID
				if attachmentID == "" {
					attachmentID = returned.AttachmentIDs[attachment.FileName]
				}
				if attachmentID == "" {
					return fmt.Errorf("server did not allocate attachment %q", attachment.FileName)
				}
				data, err := os.ReadFile(filepath.Join(l.Dir, attachment.Path))
				if err != nil {
					return err
				}
				if err = s.client.Upload(cmd.Context(), token, attachmentID, data, attachment.MimeType); err != nil {
					return err
				}
			}
		}
		resultSnapshot, err := s.client.Snapshot(cmd.Context(), token)
		if err != nil {
			return err
		}
		newByID := map[string]wikiapi.Page{}
		for _, p := range resultSnapshot.Pages {
			newByID[p.ID] = p
		}
		next := wikiapi.State{Version: 1, Pages: map[string]wikiapi.StatePage{}}
		for _, p := range resultSnapshot.Pages {
			if p.PageType != nil && *p.PageType == "task-list" {
				continue
			}
			saved, err := wikiapi.WritePage(root, p, newByID, token, s.client)
			if err != nil {
				return err
			}
			next.Pages[p.ID] = saved
		}
		if err := wikiapi.SaveState(root, next); err != nil {
			return err
		}
		if deferredChildren {
			return s.sync(cmd, root, resolve)
		}
		_, err = fmt.Fprintf(cmd.OutOrStdout(), "Synchronized %d Wiki pages\n", len(operations))
		return err
	})
}
