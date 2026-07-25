package main

import (
	"os"

	"github.com/gdg-jp/gdgjp/cli/internal/command"
)

func main() {
	if err := command.NewRoot().Execute(); err != nil {
		os.Exit(1)
	}
}
