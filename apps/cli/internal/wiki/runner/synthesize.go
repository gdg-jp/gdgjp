package runner

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/gdg-jp/gdgjp/cli/internal/wiki"
)

//go:embed prompts/*.md
var prompts embed.FS

func prompt(name string) string {
	raw, err := prompts.ReadFile("prompts/" + name + ".md")
	if err != nil {
		panic(err)
	}
	return string(raw)
}

const (
	synthesizeTimeout = 30 * time.Minute
	// maxBatchBytes splits a job's raw into several agent runs, by source.
	maxBatchBytes = 4 << 20
	// largeDocumentBytes marks documents the agent must read by heading, not whole.
	largeDocumentBytes = 256 << 10
	jobFile            = "JOB.md"
	jobResultFile      = "JOB_RESULT.json"
)

func (r *Runner) synthesize(ctx context.Context, job *Job) Result {
	jc, err := r.api.Context(ctx, job.ID)
	if err != nil {
		return failed(err, true)
	}
	root := r.jobDir(job.ID)
	defer os.RemoveAll(root)
	sourceIDs := make([]string, 0, len(jc.Sources))
	for _, source := range jc.Sources {
		sourceIDs = append(sourceIDs, source.ID)
	}
	if err = r.clone(ctx, root, *jc.Space, sourceIDs); err != nil {
		return failed(err, true)
	}
	paths := localDocumentPaths(root)
	batches := batchDocuments(jc.Documents, maxBatchBytes)
	if len(batches) == 0 {
		batches = [][]Document{nil} // requests only
	}
	for i, batch := range batches {
		requests := jc.Requests
		if i > 0 {
			requests = nil
		}
		if err = os.WriteFile(filepath.Join(root, jobFile), []byte(renderJobMD(*jc.Space, jc.Sources, batch, paths, requests)), 0o644); err != nil {
			return failed(err, false)
		}
		if output, runErr := r.backend.Run(ctx, root, prompt("synthesize"), synthesizeTimeout); runErr != nil {
			return failed(fmt.Errorf("%w\n%s", runErr, output), false)
		}
	}
	documentIDs := make([]string, 0, len(jc.Documents))
	for _, doc := range jc.Documents {
		documentIDs = append(documentIDs, doc.ID)
	}
	result := r.verifyAndPush(ctx, root, sourceIDs, fmt.Sprintf("synthesize %s", job.ID))
	if result.Status == "succeeded" {
		result.IntegratedDocumentIDs = documentIDs
		result.RequestOutcomes = readRequestOutcomes(root, len(jc.Requests), result)
	}
	return result
}

// verifyAndPush runs verify-acl with the job's sources as the read set. Findings get one
// fix-up run; still failing → needs_review with an acl-untagged flag, and nothing is pushed.
func (r *Runner) verifyAndPush(ctx context.Context, root string, readSources []string, message string) Result {
	check, err := r.verify(ctx, root, readSources)
	if err != nil {
		return failed(fmt.Errorf("verify-acl: %w", err), true) // fail closed: never push unverified
	}
	if !check.OK {
		fix := prompt("acl-fix") + "\n\n" + wiki.FormatACLFindings(check.Findings)
		if output, runErr := r.backend.Run(ctx, root, fix, synthesizeTimeout); runErr != nil {
			return failed(fmt.Errorf("%w\n%s", runErr, output), false)
		}
		if check, err = r.verify(ctx, root, readSources); err != nil {
			return failed(fmt.Errorf("verify-acl: %w", err), true)
		}
		if !check.OK {
			return Result{
				Status:     "needs_review",
				Error:      "acl_untagged after one fix-up run",
				ReviewFlag: &ReviewFlag{Kind: "acl-untagged", Payload: map[string]any{"findings": check.Findings}},
			}
		}
	}
	written, err := r.push(ctx, root, message)
	if errors.Is(err, errPushConflict) {
		return failed(err, true)
	}
	if err != nil {
		return failed(err, false)
	}
	return Result{Status: "succeeded", Result: map[string]any{"pagesWritten": written}}
}

// localDocumentPaths maps document id → clone-relative raw path from the pulled manifest.
func localDocumentPaths(root string) map[string]string {
	out := map[string]string{}
	state, err := wiki.LoadState(root)
	if err != nil || state.Manifest == nil {
		return out
	}
	for _, doc := range state.Manifest.Documents {
		out[doc.DocumentID] = doc.Path
	}
	return out
}

// batchDocuments groups documents by source and packs sources into batches of at most
// limit bytes. A single source over the limit is its own batch.
func batchDocuments(documents []Document, limit int64) [][]Document {
	bySource := map[string][]Document{}
	var order []string
	for _, doc := range documents {
		if _, ok := bySource[doc.SourceID]; !ok {
			order = append(order, doc.SourceID)
		}
		bySource[doc.SourceID] = append(bySource[doc.SourceID], doc)
	}
	var batches [][]Document
	var current []Document
	var size int64
	for _, sourceID := range order {
		var sourceSize int64
		for _, doc := range bySource[sourceID] {
			if doc.Bytes != nil {
				sourceSize += *doc.Bytes
			}
		}
		if len(current) > 0 && size+sourceSize > limit {
			batches = append(batches, current)
			current, size = nil, 0
		}
		current = append(current, bySource[sourceID]...)
		size += sourceSize
	}
	if len(current) > 0 {
		batches = append(batches, current)
	}
	return batches
}

func renderJobMD(space Space, sources []Source, documents []Document, paths map[string]string, requests []Request) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# Job\n\nSpace: %s (`%s`). Integration rules: `AGENTS.md`.\n\n", space.Name, space.Slug)
	used := map[string]bool{}
	for _, doc := range documents {
		used[doc.SourceID] = true
	}
	if len(documents) > 0 {
		b.WriteString("## Sources\n\nWrap anything taken from a source narrower than `member` in `<acl src=\"<id>\">…</acl>`.\n\n")
		for _, source := range sources {
			if !used[source.ID] {
				continue
			}
			fmt.Fprintf(&b, "### %s\n\n- id: `%s`\n- kind: %s\n- visibility: %s\n", source.Title, source.ID, source.Kind, source.Visibility)
			if source.ChapterID != nil && *source.ChapterID != "" {
				fmt.Fprintf(&b, "- chapter: %s\n", *source.ChapterID)
			}
			b.WriteString("\n")
		}
		b.WriteString("## Documents\n\n")
		sorted := append([]Document(nil), documents...)
		sort.Slice(sorted, func(i, j int) bool { return sorted[i].Path < sorted[j].Path })
		for _, doc := range sorted {
			path := paths[doc.ID]
			if path == "" {
				path = "(not pulled) " + doc.Path
			}
			state := "updated since the last integration"
			if doc.IsNew {
				state = "new"
			}
			size := "size unknown"
			if doc.Bytes != nil {
				size = fmt.Sprintf("%d bytes", *doc.Bytes)
				if *doc.Bytes > largeDocumentBytes {
					size += " — large: read it heading by heading, never whole"
				}
			}
			fmt.Fprintf(&b, "- `%s` (source `%s`, %s, %s)\n", path, doc.SourceID, state, size)
		}
		b.WriteString("\n")
	}
	if len(requests) > 0 {
		b.WriteString("## Requests\n\nPeople asked for these changes. Apply them to the page, or explain in `" + jobResultFile + "` why not.\n\n")
		for i, request := range requests {
			fmt.Fprintf(&b, "### %d. `%s` — %s\n\n%s\n\n", i, request.PageSlug, request.RequestedByName, quote(request.Text))
		}
	}
	return b.String()
}

func quote(text string) string {
	lines := strings.Split(strings.TrimSpace(text), "\n")
	for i, line := range lines {
		lines[i] = "> " + line
	}
	return strings.Join(lines, "\n")
}

// readRequestOutcomes reads the agent's JOB_RESULT.json; a missing entry counts as applied
// when the run wrote pages.
func readRequestOutcomes(root string, count int, result Result) []RequestOutcome {
	if count == 0 {
		return nil
	}
	var file struct {
		Requests []RequestOutcome `json:"requests"`
	}
	if raw, err := os.ReadFile(filepath.Join(root, jobResultFile)); err == nil {
		_ = json.Unmarshal(raw, &file)
	}
	wrote := false
	if summary, ok := result.Result.(map[string]any); ok {
		if pages, ok := summary["pagesWritten"].([]string); ok {
			wrote = len(pages) > 0
		}
	}
	outcomes := make([]RequestOutcome, 0, count)
	for i := 0; i < count; i++ {
		outcome := RequestOutcome{Index: i, Applied: wrote}
		for _, entry := range file.Requests {
			if entry.Index == i {
				outcome = entry
			}
		}
		if len(outcome.Note) > 200 {
			outcome.Note = outcome.Note[:200]
		}
		outcomes = append(outcomes, outcome)
	}
	return outcomes
}
