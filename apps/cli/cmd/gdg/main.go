package main

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"

	"github.com/gdg-jp/gdgjp/cli/internal/command"
	"github.com/gdg-jp/gdgjp/cli/internal/oauth"
	"github.com/gdg-jp/gdgjp/cli/internal/store"
	wiki "github.com/gdg-jp/gdgjp/cli/internal/wiki"
)

func main() {
	if filepath.Base(os.Args[0]) == "git-remote-gdg-wiki" {
		if err := runGitRemoteHelper(context.Background(), os.Args[1:]); err != nil {
			fmt.Fprintln(os.Stderr, "gdg-wiki remote:", err)
			os.Exit(1)
		}
		return
	}
	if err := command.NewRoot().Execute(); err != nil {
		os.Exit(1)
	}
}

func runGitRemoteHelper(ctx context.Context, args []string) error {
	if len(args) != 2 {
		return errors.New("expected remote name and gdg-wiki URL")
	}
	credentials := store.NewCredentials()
	credential, err := credentials.Load()
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return errors.New("not logged in; run gdg login")
		}
		return err
	}
	base, err := wikiBaseURL(args[1])
	if err != nil {
		return err
	}
	client := wiki.NewClientAt(base)
	helper := &wiki.RemoteHelper{
		Client: client, Token: credential.AccessToken, Remote: args[0],
		Stdin: os.Stdin, Stdout: os.Stdout, Stderr: os.Stderr,
	}
	helper.Snapshot = func(requestContext context.Context, token string) (wiki.Snapshot, error) {
		lang := "ja"
		if helper.GitDir != "" {
			if root, rootErr := wiki.WorkTreeRoot(helper.GitDir); rootErr == nil {
				if cfg, cfgErr := wiki.ReadConfig(root); cfgErr == nil {
					lang = cfg.Lang
				}
			}
		}
		snapshot, requestErr := client.Snapshot(requestContext, token, lang)
		if !isUnauthorized(requestErr) {
			return snapshot, requestErr
		}
		fresh, refreshErr := oauth.Refresh(requestContext, credential.RefreshToken)
		if refreshErr != nil {
			return wiki.Snapshot{}, fmt.Errorf("refresh GDG Japan login: %w", refreshErr)
		}
		if saveErr := credentials.Save(fresh); saveErr != nil {
			return wiki.Snapshot{}, fmt.Errorf("save refreshed credentials: %w", saveErr)
		}
		credential = fresh
		helper.Token = fresh.AccessToken
		return client.Snapshot(requestContext, fresh.AccessToken, lang)
	}
	helper.Sync = func(requestContext context.Context, token string, request wiki.SyncRequest) (wiki.SyncResult, error) {
		result, requestErr := client.Sync(requestContext, token, request)
		if !isUnauthorized(requestErr) {
			return result, requestErr
		}
		fresh, refreshErr := oauth.Refresh(requestContext, credential.RefreshToken)
		if refreshErr != nil {
			return wiki.SyncResult{}, fmt.Errorf("refresh GDG Japan login: %w", refreshErr)
		}
		if saveErr := credentials.Save(fresh); saveErr != nil {
			return wiki.SyncResult{}, fmt.Errorf("save refreshed credentials: %w", saveErr)
		}
		credential, helper.Token = fresh, fresh.AccessToken
		return client.Sync(requestContext, fresh.AccessToken, request)
	}
	helper.Upload = func(requestContext context.Context, token, id string, data []byte, mime string) error {
		requestErr := client.Upload(requestContext, token, id, data, mime)
		if !isUnauthorized(requestErr) {
			return requestErr
		}
		fresh, refreshErr := oauth.Refresh(requestContext, credential.RefreshToken)
		if refreshErr != nil {
			return fmt.Errorf("refresh GDG Japan login: %w", refreshErr)
		}
		if saveErr := credentials.Save(fresh); saveErr != nil {
			return fmt.Errorf("save refreshed credentials: %w", saveErr)
		}
		credential, helper.Token = fresh, fresh.AccessToken
		return client.Upload(requestContext, fresh.AccessToken, id, data, mime)
	}
	return helper.Run(ctx)
}

func isUnauthorized(err error) bool {
	var httpErr *wiki.HTTPError
	return errors.As(err, &httpErr) && httpErr.StatusCode == 401
}

func wikiBaseURL(remoteURL string) (string, error) {
	parsed, err := url.Parse(remoteURL)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" || parsed.Path != "/api/cli/wiki" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", fmt.Errorf("invalid gdg-wiki remote URL %q", remoteURL)
	}
	return parsed.Scheme + "://" + parsed.Host, nil
}
