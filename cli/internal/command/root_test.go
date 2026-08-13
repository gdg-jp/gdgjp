package command

import (
	"testing"

	"github.com/gdg-jp/gdgjp/cli/internal/store"
)

func TestShouldUseDeviceLogin(t *testing.T) {
	tests := []struct {
		name     string
		device   bool
		browser  bool
		headless bool
		want     bool
	}{
		{name: "no flags, interactive session", device: false, browser: false, headless: false, want: false},
		{name: "no flags, headless session falls back to device", device: false, browser: false, headless: true, want: true},
		{name: "--device forces device even when not headless", device: true, browser: false, headless: false, want: true},
		{name: "--browser forces browser even when headless", device: false, browser: true, headless: true, want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := shouldUseDeviceLogin(test.device, test.browser, test.headless); got != test.want {
				t.Fatalf("shouldUseDeviceLogin(%v, %v, %v) = %v, want %v", test.device, test.browser, test.headless, got, test.want)
			}
		})
	}
}

func TestLoginCommandRejectsDeviceAndBrowserTogether(t *testing.T) {
	root := NewRoot()
	root.SetArgs([]string{"login", "--device", "--browser"})
	root.SilenceUsage = true
	root.SilenceErrors = true

	err := root.Execute()
	if err == nil {
		t.Fatal("expected an error when --device and --browser are both set")
	}
}

func TestLoginCommandFlagsExist(t *testing.T) {
	command := newLoginCommand(store.NewCredentials())
	if command.Flags().Lookup("device") == nil {
		t.Fatal("expected a --device flag")
	}
	if command.Flags().Lookup("browser") == nil {
		t.Fatal("expected a --browser flag")
	}
}
