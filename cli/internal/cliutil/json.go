package cliutil

import (
	"encoding/json"
	"io"
)

// PrintJSON writes v to w as indented JSON.
//
// HTML escaping is disabled so string values (event descriptions and other
// fields that hold HTML) print with literal `<`, `>`, and `&`. This makes the
// CLI output match what `jq -r` yields for the same field, removing a class of
// mismatched-substitution bugs when callers edit long HTML bodies.
func PrintJSON(w io.Writer, v any) error {
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}
