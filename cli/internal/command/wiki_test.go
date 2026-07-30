package command

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
)

type gitCall struct {
	directory string
	args      []string
}

func testWikiService(run gitRunner) *wikiService {
	return &wikiService{
		runGit:        run,
		executable:    os.Executable,
		installHelper: func(string) (string, error) { return "git-remote-gdg-wiki", nil },
	}
}

func executeWiki(t *testing.T, service *wikiService, args ...string) (string, error) {
	t.Helper()
	command := newWikiCommandWithService(service)
	output := new(strings.Builder)
	command.SetOut(output)
	command.SetErr(output)
	command.SetArgs(args)
	err := command.ExecuteContext(context.Background())
	return output.String(), err
}

func TestWikiCloneUsesGDGWikiRemote(t *testing.T) {
	var calls []gitCall
	var installed string
	service := testWikiService(func(_ context.Context, directory string, args ...string) (string, error) {
		calls = append(calls, gitCall{directory: directory, args: args})
		return "cloned\n", nil
	})
	service.installHelper = func(executable string) (string, error) {
		installed = executable
		return "git-remote-gdg-wiki", nil
	}

	output, err := executeWiki(t, service, "clone", "wiki")
	if err != nil {
		t.Fatal(err)
	}
	if output != "cloned\n" {
		t.Fatalf("output = %q", output)
	}
	if installed == "" {
		t.Fatal("clone did not ensure the Git helper")
	}
	if len(calls) != 1 || strings.Join(calls[0].args, " ") != "clone --origin origin "+defaultWikiRemote+" wiki" {
		t.Fatalf("calls = %#v", calls)
	}
}

func TestWikiInitConfiguresRemoteWithoutFetchingOrCommitting(t *testing.T) {
	root := t.TempDir()
	var calls []gitCall
	service := testWikiService(func(_ context.Context, directory string, args ...string) (string, error) {
		calls = append(calls, gitCall{directory: directory, args: args})
		switch strings.Join(args, " ") {
		case "rev-parse --is-inside-work-tree", "remote get-url origin":
			return "", errors.New("missing")
		default:
			return "", nil
		}
	})

	output, err := executeWiki(t, service, "init", root)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output, "git pull") {
		t.Fatalf("unexpected output: %q", output)
	}
	got := make([]string, 0, len(calls))
	for _, call := range calls {
		got = append(got, strings.Join(call.args, " "))
	}
	want := []string{
		"rev-parse --is-inside-work-tree",
		"init -b main",
		"remote get-url origin",
		"remote add origin " + defaultWikiRemote,
		"config branch.main.remote origin",
		"config branch.main.merge refs/heads/main",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("Git calls:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}
