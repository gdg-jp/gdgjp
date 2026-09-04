package agenthost

import (
	"context"
	"testing"
)

func TestVerifyHostPrefix(t *testing.T) {
	tmpDir := t.TempDir()

	err := VerifyHost(context.Background(), VerifyOptions{
		Prefix: tmpDir,
	})
	if err != nil {
		t.Fatalf("expected nil in prefix mode, got: %v", err)
	}
}

func TestVerifyHostNonExistentUser(t *testing.T) {
	// On machines where gdgagent-run-0 does not exist, VerifyHost must skip and return nil
	err := VerifyHost(context.Background(), VerifyOptions{})
	if err != nil {
		t.Fatalf("expected nil when OS user does not exist, got: %v", err)
	}
}
