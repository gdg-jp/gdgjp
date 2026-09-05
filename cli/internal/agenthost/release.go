package agenthost

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// DefaultReleaseManifestBaseURL is where Tier 2 releases are published by
// .github/workflows/agent-host-release.yml when spec.release.manifestBaseURL is unset.
const DefaultReleaseManifestBaseURL = "https://github.com/gdg-jp/gdgjp/releases/download/agent-host-release-latest"

// DefaultReleaseKeep is how many release generations are retained under releasesRoot when
// spec.release.keep is unset.
const DefaultReleaseKeep = 5

// LiveSpecPath is the canonical spec location published by every successful release apply.
// Every gdg agent-host subcommand falls back to this path (see command/agent_host.go) when
// neither --spec nor GDG_SPEC is set, so that a config-only release takes effect for every
// future invocation -- apply, verify, sync-workspace, and the next release apply alike --
// without requiring the operator to pass --spec by hand.
const LiveSpecPath = "/etc/gdg-agent/agent-host.json"

// ApplyReleaseOptions controls a Tier 2 control-plane release fetch/verify/apply cycle.
type ApplyReleaseOptions struct {
	// SpecPath seeds release.manifestBaseURL/keep/pubkey resolution when no live spec exists yet
	// (first-ever release on a freshly bootstrapped host). Normally left empty so the live spec
	// published by the previous release apply is used.
	SpecPath        string
	OverlayPath     string
	Prefix          string
	ReleasesRoot    string // override for tests; defaults to {prefix}/var/lib/agent-host/releases
	ManifestBaseURL string // override for tests/operators; defaults to spec.release.manifestBaseURL
	PubKeyPath      string
	Keep            int
	SlotCount       int
	DryRun          bool
	Diff            bool
	Timeout         time.Duration

	// CurrentVersion is this running gdg binary's own version, used to decide whether the
	// extracted release's pins.gdgCli requires a self re-exec before any host/workspace mutation
	// (see CheckAndReexecSelf). Defaults to "dev" when unset, which never re-execs -- matching
	// the ordinary `apply` command's own default when no build-time version was injected.
	CurrentVersion string
	// Args are the argv CheckAndReexecSelf re-execs with (normally os.Args); defaults to os.Args
	// when nil.
	Args []string
	// ReexecFn overrides how re-exec is performed; nil defaults to DefaultReexec (syscall.Exec).
	// Tests inject a fake here together with GDG_REEXEC_TEST_HOOK=1.
	ReexecFn ReexecFunc
}

func resolveReleasesRoot(prefix, override string) string {
	if override != "" {
		return override
	}
	return filepath.Join(prefix, "var/lib/agent-host/releases")
}

func resolveLiveSpecPath(prefix string) string {
	if prefix == "" {
		return LiveSpecPath
	}
	return filepath.Join(prefix, strings.TrimPrefix(LiveSpecPath, "/"))
}

// ApplyRelease fetches the latest signed Tier 2 control-plane release, verifies its Ed25519
// signature before ever touching the archive, and converges the host to it.
//
// Semantics (matching the design's pull-loop contract exactly):
//   - If the fetched version equals the currently-installed one, this is a **report-only** drift
//     check against the already-installed generation -- it never re-extracts, re-applies, or
//     mutates anything, regardless of --dry-run. A periodic timer run must not silently "repair"
//     drift on an unchanged release; that would mask host tampering as routine convergence.
//   - If the fetched version is new and --dry-run is set, it is extracted into disposable staging
//     for a preview only; nothing is written to the durable release store.
//   - If the fetched version is new and this is a real apply, the release is applied from staging
//     (self-re-exec to the pinned gdgCli happens first, before any mutation), then verified. Only
//     after verification succeeds is the staged extraction promoted into the durable release
//     store, the live spec published, and the current pointer moved. Any failure from this point
//     (apply or verify) triggers an automatic rollback to the previously-installed generation; if
//     none exists, the failure is surfaced loudly rather than silently continuing.
func ApplyRelease(ctx context.Context, opts ApplyReleaseOptions) error {
	seedSpecPath := opts.SpecPath
	if seedSpecPath == "" {
		if live := resolveLiveSpecPath(opts.Prefix); fileExists(live) {
			seedSpecPath = live
		}
	}
	seedSpec, err := LoadSpecWithOverlay(seedSpecPath, opts.OverlayPath)
	if err != nil {
		return fmt.Errorf("load seed spec: %w", err)
	}

	baseURL := strings.TrimSpace(opts.ManifestBaseURL)
	if baseURL == "" && seedSpec.Release != nil {
		baseURL = strings.TrimSpace(seedSpec.Release.ManifestBaseURL)
	}
	if baseURL == "" {
		baseURL = DefaultReleaseManifestBaseURL
	}

	keep := opts.Keep
	if keep <= 0 && seedSpec.Release != nil && seedSpec.Release.Keep > 0 {
		keep = seedSpec.Release.Keep
	}
	if keep <= 0 {
		keep = DefaultReleaseKeep
	}

	agentRoot := seedSpec.Paths.AgentRoot
	if opts.Prefix != "" {
		agentRoot = filepath.Join(opts.Prefix, strings.TrimPrefix(agentRoot, "/"))
	}
	pubKeyPath := opts.PubKeyPath
	if pubKeyPath == "" {
		pubKeyPath = filepath.Join(agentRoot, "lib", "release-key.pub")
	}

	releasesRoot := resolveReleasesRoot(opts.Prefix, opts.ReleasesRoot)
	if err := os.MkdirAll(releasesRoot, 0o700); err != nil {
		return fmt.Errorf("create releases root %s: %w", releasesRoot, err)
	}

	stagingRoot, err := os.MkdirTemp(releasesRoot, ".fetch-*")
	if err != nil {
		return fmt.Errorf("create staging dir: %w", err)
	}
	defer os.RemoveAll(stagingRoot)

	version, manifest, archivePath, err := fetchAndVerifyReleaseArtifacts(ctx, baseURL, pubKeyPath, stagingRoot)
	if err != nil {
		return fmt.Errorf("fetch/verify release: %w", err)
	}

	currentVersion, err := CurrentReleaseVersion(releasesRoot)
	if err != nil {
		return fmt.Errorf("read current release pointer: %w", err)
	}

	// Same version as already installed: report-only drift check against the *already installed*
	// generation. Never touches the archive's extraction or the durable store -- a re-fetch of an
	// unchanged release must not itself be a source of mutation.
	if version != "" && version == currentVersion {
		return planReleaseDryRun(ctx, filepath.Join(releasesRoot, version), opts)
	}

	// Extract into disposable staging -- never directly into the persisted releasesRoot/<version>
	// until it is actually promoted below, so a dry-run (or a failed apply) can never clobber a
	// durable generation on disk, including the one a subsequent rollback would need.
	stagedDir := filepath.Join(stagingRoot, "extracted")
	if err := os.MkdirAll(stagedDir, 0o700); err != nil {
		return fmt.Errorf("create staging extraction dir: %w", err)
	}
	if err := ExtractArchiveSafely(archivePath, stagedDir, manifest, 0, 0); err != nil {
		return fmt.Errorf("extract release archive: %w", err)
	}

	if opts.DryRun {
		return planReleaseDryRun(ctx, stagedDir, opts)
	}

	extractedSpec, err := LoadSpecWithOverlay(filepath.Join(stagedDir, "agent-host.json"), "")
	if err != nil {
		return fmt.Errorf("load extracted spec: %w", err)
	}

	// Self re-exec to the pinned gdgCli *before* any host/workspace mutation, using the
	// authenticated extracted spec's pins -- not the currently-running (possibly stale) binary's
	// own idea of what should be pinned. On a real re-exec this replaces the process image and
	// never returns; reaching past this line means either no re-exec was needed, or (tests only)
	// a hook intercepted it.
	reexecArgs := opts.Args
	if reexecArgs == nil {
		reexecArgs = os.Args
	}
	currentCLIVersion := opts.CurrentVersion
	if currentCLIVersion == "" {
		currentCLIVersion = "dev"
	}
	if err := CheckAndReexecSelf(ctx, currentCLIVersion, extractedSpec, reexecArgs, opts.ReexecFn); err != nil {
		return fmt.Errorf("self re-exec for pinned gdgCli failed: %w", err)
	}

	if err := applyReleaseGeneration(ctx, stagedDir, version, opts); err != nil {
		return rollbackOrFail(ctx, releasesRoot, currentVersion, opts,
			fmt.Errorf("apply release %s failed: %w", version, err))
	}

	if err := VerifyHost(ctx, VerifyOptions{SpecPath: filepath.Join(stagedDir, "agent-host.json"), Prefix: opts.Prefix}); err != nil {
		return rollbackOrFail(ctx, releasesRoot, currentVersion, opts,
			fmt.Errorf("release %s failed verification: %w", version, err))
	}

	// Promote: only now, with the new generation applied and verified, does it become part of the
	// durable release store, the live spec, and the current pointer.
	promotedDir := filepath.Join(releasesRoot, version)
	if err := os.RemoveAll(promotedDir); err != nil {
		return fmt.Errorf("clear stale release dir %s: %w", promotedDir, err)
	}
	if err := os.Rename(stagedDir, promotedDir); err != nil {
		return fmt.Errorf("promote staged release to %s: %w", promotedDir, err)
	}
	if err := publishLiveSpec(filepath.Join(promotedDir, "agent-host.json"), opts.Prefix); err != nil {
		return fmt.Errorf("publish live spec: %w", err)
	}
	if err := setCurrentRelease(releasesRoot, version); err != nil {
		return fmt.Errorf("update current release pointer: %w", err)
	}
	if err := pruneReleaseGenerations(releasesRoot, keep); err != nil {
		fmt.Printf("warning: failed to prune old release generations under %s: %v\n", releasesRoot, err)
	}

	fmt.Printf("release %s applied and verified successfully\n", version)
	return nil
}

// rollbackOrFail is the single path every apply-time failure (whether from applying the new
// generation or from its post-apply VerifyHost) routes through: it never leaves the host on a
// known-broken generation without either repairing it or reporting failure loudly. cause is
// wrapped into every returned error so the original failure is never lost.
func rollbackOrFail(ctx context.Context, releasesRoot, currentVersion string, opts ApplyReleaseOptions, cause error) error {
	if currentVersion == "" {
		return fmt.Errorf("%w (no previously-installed release exists to automatically roll back to)", cause)
	}
	fmt.Printf("%v; rolling back to %s\n", cause, currentVersion)

	prevDir := filepath.Join(releasesRoot, currentVersion)
	if rbErr := applyReleaseGeneration(ctx, prevDir, currentVersion, opts); rbErr != nil {
		return fmt.Errorf("%w (automatic rollback to %s ALSO failed to apply: %v)", cause, currentVersion, rbErr)
	}
	if vErr := VerifyHost(ctx, VerifyOptions{SpecPath: filepath.Join(prevDir, "agent-host.json"), Prefix: opts.Prefix}); vErr != nil {
		return fmt.Errorf("%w (rolled back to %s but it ALSO fails verification: %v)", cause, currentVersion, vErr)
	}
	if err := publishLiveSpec(filepath.Join(prevDir, "agent-host.json"), opts.Prefix); err != nil {
		return fmt.Errorf("%w (automatic rollback to %s applied and verified but failed to republish its live spec: %v)", cause, currentVersion, err)
	}
	if err := setCurrentRelease(releasesRoot, currentVersion); err != nil {
		return fmt.Errorf("%w (automatic rollback to %s applied and verified but failed to update the current pointer: %v)", cause, currentVersion, err)
	}
	return fmt.Errorf("%w (automatically rolled back to %s)", cause, currentVersion)
}

// planReleaseDryRun reports drift for the release already extracted at dir, reusing Stage 06's
// apply --dry-run --diff semantics (including ErrDriftDetected) rather than reimplementing them.
// It is read-only: BuildPlan/ApplyPlan(DryRun: true) never write to disk.
func planReleaseDryRun(ctx context.Context, dir string, opts ApplyReleaseOptions) error {
	configDir := filepath.Join(dir, "config")
	return withConfigOverrideRoot(configDir, func() error {
		plan, err := BuildPlan(ctx, PlanOptions{
			SpecPath:  filepath.Join(dir, "agent-host.json"),
			Prefix:    opts.Prefix,
			SlotCount: opts.SlotCount,
		})
		if err != nil {
			return fmt.Errorf("plan release dry-run: %w", err)
		}
		return ApplyPlan(ctx, plan, ApplyOptions{DryRun: true, Diff: opts.Diff})
	})
}

// applyReleaseGeneration converges the host to the release generation already extracted at dir.
// It never fetches, verifies a signature, publishes the live spec, or moves the current pointer --
// those are the caller's responsibility once this (and a subsequent VerifyHost) has succeeded.
// dir must already have been produced by a successful ExtractArchiveSafely call (either a fresh
// staged extraction, or a previously-promoted generation being re-applied for rollback).
func applyReleaseGeneration(ctx context.Context, dir, version string, opts ApplyReleaseOptions) error {
	extractedSpecPath := filepath.Join(dir, "agent-host.json")
	configDir := filepath.Join(dir, "config")

	// The release's own config/ -- not whatever gdg binary happens to be running -- is what gets
	// converged: this is what makes a config-only release (e.g. a hooks.json change) actually
	// take effect without a new gdg CLI build. Wraps spec loading too, so ValidateBundleInvariants
	// (invoked from parseSpecBytes) validates the release's own bundle, not a stale embedded one.
	return withConfigOverrideRoot(configDir, func() error {
		spec, err := LoadSpecWithOverlay(extractedSpecPath, "")
		if err != nil {
			return fmt.Errorf("load extracted spec %s: %w", extractedSpecPath, err)
		}

		// 1. Tier 1: apply workspace/ exclusively through the Stage 09 transaction. Never as
		// generic file/dir resources -- BuildPlan below structurally refuses to emit those
		// (plan.go's ValidateWorkspaceDelegation), so this is the only path workspace/ content
		// can take.
		workspaceDir := filepath.Join(dir, "workspace")
		if fi, statErr := os.Stat(workspaceDir); statErr == nil && fi.IsDir() {
			desiredFiles, walkErr := loadDesiredFilesFromDir(workspaceDir)
			if walkErr != nil {
				return fmt.Errorf("read release workspace subtree: %w", walkErr)
			}
			wikiRoot := spec.Paths.Workspace
			varLibDir := "/var/lib/agent-host"
			if opts.Prefix != "" {
				wikiRoot = filepath.Join(opts.Prefix, strings.TrimPrefix(wikiRoot, "/"))
				varLibDir = filepath.Join(opts.Prefix, "var/lib/agent-host")
			}
			err := withWorkspaceMutexAndRecovery(wikiRoot, varLibDir, opts.Timeout, func() error {
				return ApplyWorkspaceFiles(ApplyWorkspaceFilesOptions{
					WikiRoot:     wikiRoot,
					VarLibDir:    varLibDir,
					DesiredFiles: desiredFiles,
					Version:      version,
				})
			})
			if err != nil {
				return fmt.Errorf("apply release workspace subtree (Tier 1 delegation): %w", err)
			}
		}

		// 2. Everything else: spec, config, packages, systemd -- via the standard converger.
		plan, err := BuildPlan(ctx, PlanOptions{
			SpecPath:  extractedSpecPath,
			Prefix:    opts.Prefix,
			SlotCount: opts.SlotCount,
			Prune:     true,
		})
		if err != nil {
			return fmt.Errorf("plan release %s: %w", version, err)
		}
		if err := ApplyPlan(ctx, plan, ApplyOptions{}); err != nil {
			return fmt.Errorf("converge release %s: %w", version, err)
		}
		return nil
	})
}

func publishLiveSpec(extractedSpecPath, prefix string) error {
	data, err := os.ReadFile(extractedSpecPath)
	if err != nil {
		return err
	}
	dest := resolveLiveSpecPath(prefix)
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	tmp := dest + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, dest); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func loadDesiredFilesFromDir(root string) (map[string][]byte, error) {
	files := make(map[string][]byte)
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, relErr := filepath.Rel(root, path)
		if relErr != nil {
			return relErr
		}
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		files[filepath.ToSlash(rel)] = data
		return nil
	})
	if err != nil {
		return nil, err
	}
	return files, nil
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// fetchAndVerifyReleaseArtifacts fetches the release pointer (latest.txt), then the manifest
// envelope and its detached Ed25519 signature, and verifies the signature -- all before the
// archive is ever downloaded or touched, matching the design's required verification order:
// signature -> envelope -> archive digest/size -> extraction -> per-file digest.
func fetchAndVerifyReleaseArtifacts(ctx context.Context, baseURL, pubKeyPath, stagingDir string) (version string, envelope ManifestEnvelope, archivePath string, err error) {
	client := &http.Client{Timeout: 60 * time.Second}
	base := strings.TrimSuffix(baseURL, "/")

	versionRaw, err := fetchBounded(ctx, client, base+"/latest.txt", 1024)
	if err != nil {
		return "", ManifestEnvelope{}, "", fmt.Errorf("fetch latest.txt: %w", err)
	}
	version = strings.TrimSpace(string(versionRaw))
	if version == "" {
		return "", ManifestEnvelope{}, "", errors.New("latest.txt is empty")
	}

	manifestName := fmt.Sprintf("agent-host-release-%s.manifest.json", version)
	sigName := manifestName + ".sig"

	manifestRaw, err := fetchBounded(ctx, client, base+"/"+manifestName, 1024*1024)
	if err != nil {
		return "", ManifestEnvelope{}, "", fmt.Errorf("fetch manifest: %w", err)
	}
	sigRaw, err := fetchBounded(ctx, client, base+"/"+sigName, 4096)
	if err != nil {
		return "", ManifestEnvelope{}, "", fmt.Errorf("fetch signature: %w", err)
	}

	pubKeyRaw, err := os.ReadFile(pubKeyPath)
	if err != nil {
		return "", ManifestEnvelope{}, "", fmt.Errorf("read release public key %s: %w", pubKeyPath, err)
	}
	pubKey, err := ParsePublicKey(pubKeyRaw)
	if err != nil {
		return "", ManifestEnvelope{}, "", err
	}

	// Signature verified before the archive is ever downloaded.
	if err := VerifyEnvelopeSignature(manifestRaw, sigRaw, pubKey); err != nil {
		return "", ManifestEnvelope{}, "", fmt.Errorf("signature verification failed: %w", err)
	}

	env, err := ParseManifestEnvelope(manifestRaw)
	if err != nil {
		return "", ManifestEnvelope{}, "", err
	}
	if env.Version != version {
		return "", ManifestEnvelope{}, "", fmt.Errorf("latest.txt version %q does not match signed manifest version %q", version, env.Version)
	}

	// Download is bounded by the signed manifest's own declared size: a compromised or
	// misbehaving upstream cannot exhaust disk before the digest check below even runs.
	archivePath = filepath.Join(stagingDir, env.Archive.Name)
	if err := fetchToFile(ctx, client, base+"/"+env.Archive.Name, archivePath, env.Archive.Size); err != nil {
		return "", ManifestEnvelope{}, "", fmt.Errorf("fetch archive: %w", err)
	}

	return version, env, archivePath, nil
}

// fetchBounded reads up to maxBytes from url, which may be an http(s):// URL or a file:// path
// (the latter used by tests so release fetch/verify is exercisable without real network access).
func fetchBounded(ctx context.Context, client *http.Client, url string, maxBytes int64) ([]byte, error) {
	if path, ok := strings.CutPrefix(url, "file://"); ok {
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		if int64(len(data)) > maxBytes {
			return nil, fmt.Errorf("file %s exceeds size bound %d bytes", path, maxBytes)
		}
		return data, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch %s returned HTTP %d", url, resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > maxBytes {
		return nil, fmt.Errorf("response from %s exceeds size bound %d bytes", url, maxBytes)
	}
	return data, nil
}

// fetchToFile downloads url to destPath, bounded by expectedSize (the signed manifest's declared
// archive.size) rather than an unlimited stream: a compromised or misbehaving upstream response
// cannot exhaust the disk before ExtractArchiveSafely's own digest check would have rejected it
// anyway. Any size mismatch removes the partial file and fails closed. expectedSize < 0 disables
// the bound (not used by fetchAndVerifyReleaseArtifacts, kept only for potential direct callers).
func fetchToFile(ctx context.Context, client *http.Client, url, destPath string, expectedSize int64) error {
	if path, ok := strings.CutPrefix(url, "file://"); ok {
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if expectedSize >= 0 && int64(len(data)) != expectedSize {
			return fmt.Errorf("file %s size %d does not match manifest-declared size %d", path, len(data), expectedSize)
		}
		return os.WriteFile(destPath, data, 0o600)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("fetch %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("fetch %s returned HTTP %d", url, resp.StatusCode)
	}

	f, err := os.Create(destPath)
	if err != nil {
		return err
	}

	var reader io.Reader = resp.Body
	if expectedSize >= 0 {
		reader = io.LimitReader(resp.Body, expectedSize+1)
	}
	written, copyErr := io.Copy(f, reader)
	closeErr := f.Close()
	if copyErr != nil {
		_ = os.Remove(destPath)
		return fmt.Errorf("download %s: %w", url, copyErr)
	}
	if closeErr != nil {
		_ = os.Remove(destPath)
		return closeErr
	}
	if expectedSize >= 0 && written != expectedSize {
		_ = os.Remove(destPath)
		return fmt.Errorf("download %s: got %d bytes, manifest declares %d", url, written, expectedSize)
	}
	return nil
}
