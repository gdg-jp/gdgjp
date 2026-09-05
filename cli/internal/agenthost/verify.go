package agenthost

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strings"
)

type VerifyOptions struct {
	SpecPath    string
	OverlayPath string
	Prefix      string
}

// VerifyHost runs the 13 verification checks verifying the agent-host isolation boundary.
func VerifyHost(ctx context.Context, opts VerifyOptions) error {
	spec, err := loadSpecWithOverlay(opts.SpecPath, opts.OverlayPath)
	if err != nil {
		return err
	}

	wikiRoot := spec.Paths.Workspace
	agentRoot := spec.Paths.AgentRoot

	prefix := opts.Prefix
	if prefix == "" {
		prefix = os.Getenv("GDG_SETUP_PREFIX")
	}

	if prefix != "" {
		fmt.Printf("verify: prefix mode active (%s); checking filesystem invariants.\n", prefix)
		var failures []string
		pWikiRoot := filepath.Join(prefix, strings.TrimPrefix(wikiRoot, "/"))
		if fi, err := os.Stat(filepath.Join(pWikiRoot, ".xangi")); err == nil && fi.IsDir() {
			failures = append(failures, "dataDir must not live under the wiki worktree")
		}
		speechDir := filepath.Join(pWikiRoot, "speech")
		sessionsDir := filepath.Join(pWikiRoot, "logs", "sessions")
		if _, err1 := os.Stat(speechDir); err1 == nil {
			failures = append(failures, "conversation logs must not live under the wiki worktree")
		} else if _, err2 := os.Stat(sessionsDir); err2 == nil {
			failures = append(failures, "conversation logs must not live under the wiki worktree")
		}

		journalDir := filepath.Join(prefix, "var/lib/agent-host/workspace-journal")
		hasIncomplete, txns, err := CheckIncompleteTransactions(journalDir)
		if err != nil {
			fmt.Fprintf(os.Stderr, "    FAIL error checking workspace sync journals: %v\n", err)
			failures = append(failures, fmt.Sprintf("error checking workspace sync journals: %v", err))
		} else if hasIncomplete {
			fmt.Fprintf(os.Stderr, "    FAIL incomplete workspace sync transactions found: %v\n", txns)
			failures = append(failures, fmt.Sprintf("incomplete workspace sync transactions found: %v", txns))
		}

		if len(failures) > 0 {
			return fmt.Errorf("verification failed: %d checks did not meet expectations", len(failures))
		}
		return nil
	}

	_, lookupErr := user.Lookup("gdgagent-run-0")
	if lookupErr != nil {
		fmt.Println("    skip live uid checks until OS users exist")
		return nil
	}

	fmt.Println("==> Verification (expect fail/success as labelled)")

	var failures []string

	runCheck := func(expect string, command ...string) {
		cmd := exec.CommandContext(ctx, command[0], command[1:]...)
		err := cmd.Run()
		success := (err == nil)

		cmdStr := strings.Join(command, " ")
		if success {
			if expect == "ok" {
				fmt.Printf("    OK  %s\n", cmdStr)
			} else {
				fmt.Fprintf(os.Stderr, "    FAIL expected failure: %s\n", cmdStr)
				failures = append(failures, fmt.Sprintf("expected failure: %s", cmdStr))
			}
		} else {
			if expect == "fail" {
				fmt.Printf("    OK  (failed as required) %s\n", cmdStr)
			} else {
				fmt.Fprintf(os.Stderr, "    FAIL expected success: %s\n", cmdStr)
				failures = append(failures, fmt.Sprintf("expected success: %s", cmdStr))
			}
		}
	}

	// Helper to run as user via sudo -u or runuser -u
	runAs := func(username string, args ...string) []string {
		if _, err := exec.LookPath("sudo"); err == nil {
			return append([]string{"sudo", "-u", username}, args...)
		}
		return append([]string{"runuser", "-u", username, "--"}, args...)
	}

	runRoot := spec.Paths.RunRoot

	// 1. Credentials not readable by slot user
	runCheck("fail", runAs("gdgagent-run-0", "cat", "/home/gdgagent-svc/.config/gdg/credentials.json")...)

	// 2 & 3. Wiki writable by slot and svc
	runCheck("ok", runAs("gdgagent-run-0", "test", "-w", wikiRoot)...)
	runCheck("ok", runAs("gdgagent-svc", "test", "-w", wikiRoot)...)

	// 4. Socket isolation between slots
	authzSock := filepath.Join(runRoot, "1", "authz.sock")
	if _, err := os.Stat(authzSock); err == nil {
		runCheck("fail", runAs("gdgagent-run-0", "test", "-r", authzSock)...)
	}

	// 5, 6, 7. Bin / lib / package.json not writable by slot
	runCheck("fail", runAs("gdgagent-run-0", "test", "-w", filepath.Join(agentRoot, "bin", "wk"))...)
	runCheck("fail", runAs("gdgagent-run-0", "test", "-w", filepath.Join(agentRoot, "lib", "wk.ts"))...)
	runCheck("fail", runAs("gdgagent-run-0", "test", "-w", filepath.Join(agentRoot, "package.json"))...)

	// 8. Projects directory writable by slot
	runCheck("ok", runAs("gdgagent-run-0", "test", "-w", "/home/gdgagent-run-0/.cursor/projects")...)

	// 9. mcp.json not writable by slot
	runCheck("fail", runAs("gdgagent-run-0", "test", "-w", "/home/gdgagent-run-0/.cursor/mcp.json")...)

	// 10. cli-config.json writable by slot
	runCheck("ok", runAs("gdgagent-run-0", "test", "-w", "/home/gdgagent-run-0/.cursor/cli-config.json")...)

	// 11, 12. sandbox.json and hooks.json not writable by slot
	runCheck("fail", runAs("gdgagent-run-0", "test", "-w", "/home/gdgagent-run-0/.cursor/sandbox.json")...)
	runCheck("fail", runAs("gdgagent-run-0", "test", "-w", "/home/gdgagent-run-0/.cursor/hooks.json")...)

	// 13. DATA_DIR not readable by slot
	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "/home/gdgagent-svc/.local/share/xangi"
	}
	if fi, err := os.Stat(dataDir); err == nil && fi.IsDir() {
		runCheck("fail", runAs("gdgagent-run-0", "test", "-r", dataDir)...)
	}

	// Extra worktree boundary checks
	if fi, err := os.Stat(filepath.Join(wikiRoot, ".xangi")); err == nil && fi.IsDir() {
		fmt.Fprintf(os.Stderr, "    FAIL dataDir must not live under the wiki worktree\n")
		failures = append(failures, "dataDir must not live under the wiki worktree")
	}

	speechDir := filepath.Join(wikiRoot, "speech")
	sessionsDir := filepath.Join(wikiRoot, "logs", "sessions")
	if _, err1 := os.Stat(speechDir); err1 == nil {
		fmt.Fprintf(os.Stderr, "    FAIL conversation logs must not live under the wiki worktree\n")
		failures = append(failures, "conversation logs must not live under the wiki worktree")
	} else if _, err2 := os.Stat(sessionsDir); err2 == nil {
		fmt.Fprintf(os.Stderr, "    FAIL conversation logs must not live under the wiki worktree\n")
		failures = append(failures, "conversation logs must not live under the wiki worktree")
	}

	// 14. Verification public key not writable by slot user
	pubKeyPath := filepath.Join(agentRoot, "lib", "release-key.pub")
	if _, err := os.Stat(pubKeyPath); err == nil {
		runCheck("fail", runAs("gdgagent-run-0", "test", "-w", pubKeyPath)...)
	}

	// 15. Incomplete workspace sync transaction journals must not remain
	journalDir := "/var/lib/agent-host/workspace-journal"
	if prefix != "" {
		journalDir = filepath.Join(prefix, "var/lib/agent-host/workspace-journal")
	}
	hasIncomplete, txns, err := CheckIncompleteTransactions(journalDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "    FAIL error checking workspace sync journals: %v\n", err)
		failures = append(failures, fmt.Sprintf("error checking workspace sync journals: %v", err))
	} else if hasIncomplete {
		fmt.Fprintf(os.Stderr, "    FAIL incomplete workspace sync transactions found: %v\n", txns)
		failures = append(failures, fmt.Sprintf("incomplete workspace sync transactions found: %v", txns))
	}

	if len(failures) > 0 {
		return fmt.Errorf("verification failed: %d checks did not meet expectations", len(failures))
	}

	return nil
}
