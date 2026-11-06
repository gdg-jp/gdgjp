package runner

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
)

// consolidate tidies one space from pages alone: merges duplicates, fixes links, updates
// index pages. No raw is pulled and no new topic pages are made.
func (r *Runner) consolidate(ctx context.Context, job *Job) Result {
	jc, err := r.api.Context(ctx, job.ID)
	if err != nil {
		return failed(err, true)
	}
	root := r.jobDir(job.ID)
	defer os.RemoveAll(root)
	if err = r.clone(ctx, root, *jc.Space, nil); err != nil {
		return failed(err, true)
	}
	jobMD := fmt.Sprintf("# Job\n\nSpace: %s (`%s`). Consolidate only; raw sources are not available.\n", jc.Space.Name, jc.Space.Slug)
	if err = os.WriteFile(filepath.Join(root, jobFile), []byte(jobMD), 0o644); err != nil {
		return failed(err, false)
	}
	if output, runErr := r.backend.Run(ctx, root, prompt("consolidate"), synthesizeTimeout); runErr != nil {
		return failed(fmt.Errorf("%w\n%s", runErr, output), false)
	}
	return r.verifyAndPush(ctx, root, []string{}, fmt.Sprintf("consolidate %s", job.ID))
}
