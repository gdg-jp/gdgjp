package update

import "testing"

func TestVerifyChecksum(t *testing.T) {
	contents := []byte("gdg archive")
	manifest := []byte("93449f8f1e124dbce8d45a32faa1079500856d2e76307f02a1c35ca586ff0b15  gdg_1.0.0_darwin_arm64.zip\n")
	if err := verifyChecksum("gdg_1.0.0_darwin_arm64.zip", contents, manifest); err != nil {
		t.Fatalf("verifyChecksum() error = %v", err)
	}
	if err := verifyChecksum("gdg_1.0.0_darwin_arm64.zip", []byte("tampered"), manifest); err == nil {
		t.Fatal("verifyChecksum() accepted a mismatched archive")
	}
}

func TestCompareVersions(t *testing.T) {
	if compareVersions("1.10.0", "1.9.0") <= 0 {
		t.Fatal("1.10.0 should be newer than 1.9.0")
	}
	if !validVersion("cli/v1.2.3") || validVersion("go-extension-abc") {
		t.Fatal("CLI release tag filtering is incorrect")
	}
}
