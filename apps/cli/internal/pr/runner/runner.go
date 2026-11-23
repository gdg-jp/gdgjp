package runner

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"sync"
	"time"

	wikirunner "github.com/gdg-jp/gdgjp/cli/internal/wiki/runner"
)

var JobTypes = []string{"assist", "fix", "post", "copy", "page", "asset", "plan", "analyze", "retro"}

type Config struct {
	BaseURL     string
	Token       string
	Backend     string
	Model       string
	Workdir     string
	YomiyasuDir string
	RenderDir   string
	FontsDir    string
	Python      string
	Host        string
	Version     string
	Once        bool
	DryRun      bool
}

func ConfigFromEnv() Config {
	host, _ := os.Hostname()
	cfg := Config{
		BaseURL:     os.Getenv("GDG_PR_URL"),
		Token:       os.Getenv("RUNNER_TOKEN"),
		Backend:     os.Getenv("RUNNER_BACKEND"),
		Model:       os.Getenv("RUNNER_MODEL"),
		Workdir:     os.Getenv("RUNNER_WORKDIR"),
		YomiyasuDir: os.Getenv("YOMIYASU_DIR"),
		RenderDir:   os.Getenv("GDG_RENDER_DIR"),
		FontsDir:    os.Getenv("GDG_FONTS_DIR"),
		Python:      "python3",
		Host:        host,
	}
	if cfg.BaseURL == "" {
		cfg.BaseURL = "https://pr.gdgs.jp"
	}
	if cfg.Workdir == "" {
		cfg.Workdir = "/var/lib/gdg-pr-runner"
	}
	if cfg.YomiyasuDir == "" {
		if home, err := os.UserHomeDir(); err == nil {
			cfg.YomiyasuDir = home + "/.agents/skills/yomiyasu"
		}
	}
	return cfg
}

type Runner struct {
	cfg     Config
	api     *wikirunner.API
	backend wikirunner.Backend
	log     *log.Logger

	mu      sync.Mutex
	running string
}

func New(cfg Config, logger *log.Logger) (*Runner, error) {
	if len(cfg.Token) < 32 {
		return nil, errors.New("RUNNER_TOKEN is missing or shorter than 32 characters")
	}
	backend, err := wikirunner.NewBackend(cfg.Backend, cfg.Model)
	if err != nil {
		return nil, err
	}
	return NewWithBackend(cfg, backend, logger), nil
}

func NewWithBackend(cfg Config, backend wikirunner.Backend, logger *log.Logger) *Runner {
	if logger == nil {
		logger = log.New(os.Stderr, "pr-runner: ", log.LstdFlags)
	}
	return &Runner{
		cfg:     cfg,
		api:     &wikirunner.API{BaseURL: cfg.BaseURL, Token: cfg.Token, Host: cfg.Host},
		backend: backend,
		log:     logger,
	}
}

func (r *Runner) Run(ctx context.Context) error {
	if err := os.MkdirAll(r.cfg.Workdir, 0o700); err != nil {
		return err
	}
	if r.cfg.DryRun {
		if err := r.api.Heartbeat(ctx, r.cfg.Version, r.backend.Name(), ""); err != nil {
			return fmt.Errorf("heartbeat: %w", err)
		}
		r.log.Printf("dry run ok: %s reachable, backend %s, yomiyasu %s", r.cfg.BaseURL, r.backend.Name(), yomiyasuState(r.cfg))
		return nil
	}
	go r.heartbeatLoop(ctx)
	backoff := 5 * time.Second
	for ctx.Err() == nil {
		job, err := r.api.Next(ctx, JobTypes, 25*time.Second)
		if err != nil {
			if ctx.Err() != nil {
				break
			}
			r.log.Printf("lease failed: %v (retry in %s)", err, backoff)
			sleep(ctx, backoff)
			backoff = min(backoff*2, 5*time.Minute)
			continue
		}
		backoff = 5 * time.Second
		if job != nil {
			r.process(ctx, job)
		}
		if r.cfg.Once && job != nil {
			return nil
		}
	}
	return ctx.Err()
}

func (r *Runner) heartbeatLoop(ctx context.Context) {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	for {
		r.mu.Lock()
		running := r.running
		r.mu.Unlock()
		if err := r.api.Heartbeat(ctx, r.cfg.Version, r.backend.Name(), running); err != nil && ctx.Err() == nil {
			r.log.Printf("heartbeat failed: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (r *Runner) process(ctx context.Context, job *wikirunner.Job) {
	r.mu.Lock()
	r.running = job.ID
	r.mu.Unlock()
	defer func() {
		r.mu.Lock()
		r.running = ""
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
				if err := r.api.ExtendLease(jobCtx, job.ID, job.Attempts); errors.Is(err, wikirunner.ErrLeaseLost) {
					r.log.Printf("job %s: lease lost, abandoning", job.ID)
					cancel()
					return
				}
			}
		}
	}()
	started := time.Now()
	r.log.Printf("job %s (%s, campaign %s) started", job.ID, job.Type, job.SpaceID)
	result := r.handle(jobCtx, job)
	if jobCtx.Err() != nil && ctx.Err() == nil {
		return
	}
	if err := r.api.Complete(ctx, job.ID, job.Attempts, result); err != nil {
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

func failed(err error, retry bool) wikirunner.Result {
	return wikirunner.Result{Status: "failed", Error: err.Error(), Retry: retry}
}
