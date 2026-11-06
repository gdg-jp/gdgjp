package judge

import "testing"

func TestEnforceRequiresVerbatimEvidence(t *testing.T) {
	evidence := map[string]string{"u": "会場は梅田の  グランフロント。\n定員は 200 名。"}
	if got := Enforce(Verdict{Verdict: "faithful"}, evidence); got.Verdict != "unfaithful" {
		t.Fatalf("an empty-evidence faithful verdict must become unfaithful: %+v", got)
	}
	if got := Enforce(Verdict{Verdict: "faithful", Evidence: []string{"定員は 300 名"}}, evidence); got.Verdict != "unfaithful" {
		t.Fatalf("a quote that is not in the evidence must not count: %+v", got)
	}
	if got := Enforce(Verdict{Verdict: "faithful", Evidence: []string{"会場は梅田の グランフロント。"}}, evidence); got.Verdict != "faithful" {
		t.Fatalf("a whitespace-normalized verbatim quote is evidence: %+v", got)
	}
	if got := Enforce(Verdict{Verdict: "maybe"}, evidence); got.Verdict != "unfaithful" {
		t.Fatalf("anything but faithful is unfaithful: %+v", got)
	}
}
