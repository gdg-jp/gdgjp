package wiki

import (
	"os"
	"path/filepath"
	"testing"
)

func TestInstallGitRemoteHelperCreatesAndReusesOwnSymlink(t *testing.T) {
	directory := t.TempDir()
	executable := filepath.Join(directory, "gdg")
	if err := os.WriteFile(executable, []byte("binary"), 0700); err != nil {
		t.Fatal(err)
	}
	helper, err := InstallGitRemoteHelper(executable)
	if err != nil {
		t.Fatal(err)
	}
	target, err := filepath.EvalSymlinks(helper)
	want, evalErr := filepath.EvalSymlinks(executable)
	if evalErr != nil {
		t.Fatal(evalErr)
	}
	if err != nil || target != want {
		t.Fatalf("helper target = %q, %v; want %q", target, err, want)
	}
	if second, err := InstallGitRemoteHelper(executable); err != nil || second != helper {
		t.Fatalf("second install = %q, %v", second, err)
	}
}
