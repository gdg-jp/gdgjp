package cliutil

import (
	"encoding/json"
	"io"
)

// PrintJSON writes v to w as indented JSON.
func PrintJSON(w io.Writer, v any) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}
