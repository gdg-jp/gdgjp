// Package runner is `gdg wiki runner`: the OCI-resident loop that leases agent_jobs from
// the wiki, runs a coding agent (Codex on a personal Pro login) on a local clone, and is
// the only party that pushes. The Worker never calls an LLM.
package runner

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gdg-jp/gdgjp/cli/internal/wiki"
)

// Config comes from /etc/gdg/runner.env (systemd EnvironmentFile).
type Config struct {
	BaseURL    string // GDG_WIKI_URL
	Token      string // RUNNER_TOKEN
	Backend    string // RUNNER_BACKEND=codex|gemini
	Model      string // RUNNER_MODEL (optional)
	Workdir    string // RUNNER_WORKDIR
	Host       string
	Version    string
	Executable string // the gdg binary, for `gdg wiki clone`
	Once       bool
	DryRun     bool
}

func ConfigFromEnv() Config {
	host, _ := os.Hostname()
	cfg := Config{
		BaseURL: os.Getenv("GDG_WIKI_URL"),
		Token:   os.Getenv("RUNNER_TOKEN"),
		Backend: os.Getenv("RUNNER_BACKEND"),
		Model:   os.Getenv("RUNNER_MODEL"),
		Workdir: os.Getenv("RUNNER_WORKDIR"),
		Host:    host,
	}
	if cfg.BaseURL == "" {
		cfg.BaseURL = "https://wiki.gdgs.jp"
	}
	if cfg.Workdir == "" {
		cfg.Workdir = "/var/lib/gdg-runner"
	}
	return cfg
}

// Handler turns one leased job into its result. It must not push or call the API on the
// agent's behalf beyond what the job type needs.
type Handler func(ctx context.Context, job *Job) Result

type Runner struct {
	cfg      Config
	api      *API
	backend  Backend
	log      *log.Logger
	handlers map[string]Handler
	// slots: each slot is one goroutine leasing only its own types. `answer` gets its own
	// slot (Stage 05) so a long synthesize never delays a reply.
	slots [][]string

	mu      sync.Mutex
	running map[string]bool
}

func New(cfg Config, logger *log.Logger) (*Runner, error) {
	if len(cfg.Token) < 32 {
		return nil, errors.New("RUNNER_TOKEN is missing or shorter than 32 characters")
	}
	backend, err := NewBackend(cfg.Backend, cfg.Model)
	if err != nil {
		return nil, err
	}
	if logger == nil {
		logger = log.New(os.Stderr, "runner: ", log.LstdFlags)
	}
	r := &Runner{
		cfg:     cfg,
		api:     &API{BaseURL: cfg.BaseURL, Token: cfg.Token, Host: cfg.Host},
		backend: backend,
		log:     logger,
		running: map[string]bool{},
	}
	r.handlers = map[string]Handler{
		"synthesize":  r.synthesize,
		"consolidate": r.consolidate,
		"translate":   r.translate,
	}
	r.slots = [][]string{{"synthesize", "consolidate", "translate"}}
	return r, nil
}

// Run serves jobs until ctx ends (or after one job with Once).
func (r *Runner) Run(ctx context.Context) error {
	if err := os.MkdirAll(r.cfg.Workdir, 0o700); err != nil {
		return err
	}
	if r.cfg.DryRun {
		return r.dryRun(ctx)
	}
	go r.heartbeatLoop(ctx)
	var wg sync.WaitGroup
	errs := make(chan error, len(r.slots))
	for _, types := range r.slots {
		wg.Add(1)
		go func(types []string) {
			defer wg.Done()
			errs <- r.serve(ctx, types)
		}(types)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil && !errors.Is(err, context.Canceled) {
			return err
		}
	}
	return nil
}

func (r *Runner) dryRun(ctx context.Context) error {
	if err := r.api.Heartbeat(ctx, r.cfg.Version, r.backend.Name(), ""); err != nil {
		return fmt.Errorf("heartbeat: %w", err)
	}
	if _, err := exec.LookPath(r.backend.Name()); err != nil {
		return fmt.Errorf("backend %s not on PATH: %w", r.backend.Name(), err)
	}
	r.log.Printf("dry run ok: %s reachable, backend %s present", r.cfg.BaseURL, r.backend.Name())
	return nil
}

func (r *Runner) heartbeatLoop(ctx context.Context) {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	for {
		if err := r.api.Heartbeat(ctx, r.cfg.Version, r.backend.Name(), r.runningJob()); err != nil && ctx.Err() == nil {
			r.log.Printf("heartbeat failed: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (r *Runner) runningJob() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	for id := range r.running {
		return id
	}
	return ""
}

func (r *Runner) serve(ctx context.Context, types []string) error {
	backoff := 5 * time.Second
	for ctx.Err() == nil {
		job, err := r.api.Next(ctx, types, 25*time.Second)
		if err != nil {
			if ctx.Err() != nil {
				break
			}
			r.log.Printf("lease %v failed: %v (retry in %s)", types, err, backoff)
			sleep(ctx, backoff)
			backoff = min(backoff*2, 5*time.Minute)
			continue
		}
		backoff = 5 * time.Second
		if job == nil {
			if r.cfg.Once {
				return nil
			}
			continue
		}
		r.process(ctx, job)
		if r.cfg.Once {
			return nil
		}
	}
	return ctx.Err()
}

// process runs one job with its lease kept alive, then reports the result.
func (r *Runner) process(ctx context.Context, job *Job) {
	handler := r.handlers[job.Type]
	r.mu.Lock()
	r.running[job.ID] = true
	r.mu.Unlock()
	defer func() {
		r.mu.Lock()
		delete(r.running, job.ID)
		r.mu.Unlock()
	}()
	jobCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-jobCtx.Done():
				return
			case <-ticker.C:
				if err := r.api.ExtendLease(jobCtx, job.ID); errors.Is(err, ErrLeaseLost) {
					r.log.Printf("job %s: lease lost, abandoning", job.ID)
					cancel()
					return
				}
			}
		}
	}()
	started := time.Now()
	r.log.Printf("job %s (%s, space %s) started", job.ID, job.Type, job.SpaceID)
	var result Result
	if handler == nil {
		result = Result{Status: "failed", Error: "runner has no handler for " + job.Type}
	} else {
		result = handler(jobCtx, job)
	}
	if jobCtx.Err() != nil && ctx.Err() == nil {
		return // lease lost: the server requeues it
	}
	if err := r.api.Complete(ctx, job.ID, result); err != nil {
		r.log.Printf("job %s: report failed: %v", job.ID, err)
		return
	}
	r.log.Printf("job %s: %s in %s %s", job.ID, result.Status, time.Since(started).Round(time.Second), result.Error)
}

func sleep(ctx context.Context, d time.Duration) {
	select {
	case <-ctx.Done():
	case <-time.After(d):
	}
}

func failed(err error, retry bool) Result {
	return Result{Status: "failed", Error: err.Error(), Retry: retry}
}

// --- workspace: clone, verify, push. Only the runner holds the token for these. ---

func (r *Runner) jobDir(jobID string) string {
	return filepath.Join(r.cfg.Workdir, "jobs", jobID)
}

// gdgEnv is the environment of the runner's own git / gdg subprocesses (never the agent's).
func (r *Runner) gdgEnv() []string {
	return append(os.Environ(), wiki.TokenEnv+"="+r.cfg.Token, "GDG_WIKI_URL="+r.cfg.BaseURL)
}

func (r *Runner) remoteURL() string {
	return "gdg-wiki::" + strings.TrimRight(r.cfg.BaseURL, "/") + "/api/cli/wiki"
}

func (r *Runner) clone(ctx context.Context, root string, space Space, rawSources []string) error {
	if err := os.RemoveAll(root); err != nil {
		return err
	}
	lang := space.Lang
	if lang != "en" {
		lang = "ja"
	}
	args := []string{"wiki", "clone", "--space", space.Slug, "--lang", lang, "--remote", r.remoteURL()}
	if len(rawSources) == 0 {
		args = append(args, "--no-raw")
	} else {
		args = append(args, "--raw-sources", strings.Join(rawSources, ","))
	}
	args = append(args, root)
	_, err := r.command(ctx, "", r.cfg.Executable, args...)
	return err
}

func (r *Runner) command(ctx context.Context, dir, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	cmd.Env = r.gdgEnv()
	output, err := cmd.CombinedOutput()
	if err != nil {
		return string(output), fmt.Errorf("%s %s: %w: %s", filepath.Base(name), strings.Join(args[:min(len(args), 2)], " "), err, tail(output))
	}
	return string(output), nil
}

func (r *Runner) git(ctx context.Context, dir string, args ...string) (string, error) {
	return r.command(ctx, dir, "git", append([]string{"-C", dir}, args...)...)
}

func (r *Runner) verify(ctx context.Context, root string, readSources []string) (wiki.ValidateACLResult, error) {
	client := wiki.NewClientAt(r.cfg.BaseURL)
	gitRunner := func(ctx context.Context, dir string, args ...string) (string, error) {
		return r.git(ctx, dir, args...)
	}
	return wiki.VerifyACLWithReadSources(ctx, root, client, r.cfg.Token, gitRunner, readSources)
}

var errPushConflict = errors.New("push conflict")

// push commits pages/** and pushes through the remote helper (→ /sync, where acl_required
// is the last guard). It returns the page files written; none means nothing changed.
func (r *Runner) push(ctx context.Context, root, message string) ([]string, error) {
	status, err := r.git(ctx, root, "status", "--porcelain", "--", "pages")
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(status) == "" {
		return nil, nil
	}
	if _, err = r.git(ctx, root, "add", "-A", "--", "pages"); err != nil {
		return nil, err
	}
	if _, err = r.git(ctx, root, "-c", "user.name=Knowledge Runner", "-c", "user.email=runner@wiki.gdgs.jp", "commit", "-q", "-m", message); err != nil {
		return nil, err
	}
	names, err := r.git(ctx, root, "diff", "--name-only", "HEAD~1", "HEAD", "--", "pages")
	if err != nil {
		return nil, err
	}
	if output, pushErr := r.git(ctx, root, "push", "-q", "origin", "HEAD:main"); pushErr != nil {
		if strings.Contains(output, "409") || strings.Contains(strings.ToLower(output), "conflict") {
			return nil, fmt.Errorf("%w: %v", errPushConflict, pushErr)
		}
		return nil, pushErr
	}
	return strings.Fields(names), nil
}
