package cliutil

import (
	"strings"
	"testing"
)

func TestPrintJSONDoesNotEscapeHTML(t *testing.T) {
	var buf strings.Builder
	if err := PrintJSON(&buf, map[string]string{"description": "<p>会場</p> & <br/>"}); err != nil {
		t.Fatal(err)
	}
	out := buf.String()
	if !strings.Contains(out, "<p>会場</p> & <br/>") {
		t.Fatalf("expected literal HTML, got %s", out)
	}
	for _, seq := range []string{"\\u003c", "\\u003e", "\\u0026"} {
		if strings.Contains(out, seq) {
			t.Fatalf("output still HTML-escaped (%s): %s", seq, out)
		}
	}
}
