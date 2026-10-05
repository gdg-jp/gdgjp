package wiki

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const TraceFileName = "ingest-trace.json"

// TracePathForRun is the invocation-scoped trace path used by wk. The run id
// is supplied only by the fixed agent launcher; there is no shared fallback.
func TracePathForRun(root, runID string) (string, error) {
	if runID == "" || strings.ContainsAny(runID, `/\\`) {
		return "", fmt.Errorf("missing or invalid GDG_WIKI_RUN_ID")
	}
	return filepath.Join(ConfigDir(root), "ingest-trace", runID+".json"), nil
}

func LoadTraceForRun(root, runID string) (IngestTrace, error) {
	path, err := TracePathForRun(root, runID)
	if err != nil {
		return IngestTrace{}, err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return IngestTrace{}, err
	}
	var trace IngestTrace
	if err = json.Unmarshal(raw, &trace); err != nil {
		return IngestTrace{}, fmt.Errorf("parse %s: %w", path, err)
	}
	if trace.Reads == nil {
		trace.Reads = []string{}
	}
	if trace.Writes == nil {
		trace.Writes = []string{}
	}
	if trace.SourceIDs == nil {
		trace.SourceIDs = []string{}
	}
	return trace, nil
}

// IngestTrace records files touched during one ingest agent run.
//
// Reads expand the set of sources that need tagging (never shrink it).
// Writes are audit-only for the pre-push gate — changed pages come from git.
// After a successful push the git diff is empty, so VerifyACL recovers the
// submitted page set from tip/recent commits (CollectCommittedPageRels) and
// may also use Writes for Cursor afterFileEdit (PageRelsFromTraceWrites).
// Writes must still never replace or shrink the read-source set.
type IngestTrace struct {
	RunID       string `json:"runId"`
	StartedAt   int64  `json:"startedAt"`
	QueueHeadID string `json:"queueHeadDocumentId"`
	// BaseRev is HEAD at ingest start (rev-parse). After push, VerifyACL recovers
	// only pages changed in BaseRev..HEAD so prior unrelated tip commits are not
	// attributed to the current queue-head source (acl_untagged_read_source).
	BaseRev   string   `json:"baseRev,omitempty"`
	SourceIDs []string `json:"sourceIds,omitempty"`
	Reads     []string `json:"reads"`
	Writes    []string `json:"writes"`
}

func TracePath(root string) string {
	return filepath.Join(ConfigDir(root), TraceFileName)
}

func LoadTrace(root string) (IngestTrace, error) {
	raw, err := os.ReadFile(TracePath(root))
	if os.IsNotExist(err) {
		return IngestTrace{Reads: []string{}, Writes: []string{}}, nil
	}
	if err != nil {
		return IngestTrace{}, err
	}
	var trace IngestTrace
	if err = json.Unmarshal(raw, &trace); err != nil {
		return IngestTrace{}, fmt.Errorf("parse %s: %w", TracePath(root), err)
	}
	if trace.Reads == nil {
		trace.Reads = []string{}
	}
	if trace.Writes == nil {
		trace.Writes = []string{}
	}
	return trace, nil
}

func WriteTrace(root string, trace IngestTrace) error {
	if trace.Reads == nil {
		trace.Reads = []string{}
	}
	if trace.Writes == nil {
		trace.Writes = []string{}
	}
	if trace.SourceIDs == nil {
		trace.SourceIDs = []string{}
	}
	if err := os.MkdirAll(ConfigDir(root), 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(trace, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(TracePath(root), append(raw, '\n'), 0o644)
}

func newRunID() string {
	var buf [8]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf[:])
}

// ResetIngestTrace truncates the trace for a new ingest run.
// baseRev should be the clone's HEAD (git rev-parse HEAD) when the run starts.
func ResetIngestTrace(root, queueHeadDocumentID, baseRev string) error {
	return WriteTrace(root, IngestTrace{
		RunID:       newRunID(),
		StartedAt:   time.Now().Unix(),
		QueueHeadID: queueHeadDocumentID,
		BaseRev:     strings.TrimSpace(baseRev),
		Reads:       []string{},
		Writes:      []string{},
	})
}

func ClearIngestTrace(root string) error {
	err := os.Remove(TracePath(root))
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

func appendUnique(list []string, value string) []string {
	for _, existing := range list {
		if existing == value {
			return list
		}
	}
	return append(list, value)
}

// AppendTraceRead records a clone-relative path under reads (deduped).
func AppendTraceRead(root, relPath string) error {
	trace, err := LoadTrace(root)
	if err != nil {
		// Broken JSON: start a fresh trace rather than failing the agent read.
		trace = IngestTrace{RunID: newRunID(), StartedAt: time.Now().Unix()}
	}
	trace.Reads = appendUnique(trace.Reads, filepath.ToSlash(relPath))
	return WriteTrace(root, trace)
}

// AppendTraceWrite records a clone-relative path under writes (audit only).
func AppendTraceWrite(root, relPath string) error {
	trace, err := LoadTrace(root)
	if err != nil {
		trace = IngestTrace{RunID: newRunID(), StartedAt: time.Now().Unix()}
	}
	trace.Writes = appendUnique(trace.Writes, filepath.ToSlash(relPath))
	return WriteTrace(root, trace)
}

func WriteTraceForRun(root, runID string, trace IngestTrace) error {
	path, err := TracePathForRun(root, runID)
	if err != nil {
		return err
	}
	if trace.Reads == nil {
		trace.Reads = []string{}
	}
	if trace.Writes == nil {
		trace.Writes = []string{}
	}
	if trace.SourceIDs == nil {
		trace.SourceIDs = []string{}
	}
	trace.RunID = runID
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(trace, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(raw, '\n'), 0o644)
}

// ResetIngestTraceForRun truncates the invocation-scoped trace and records BaseRev.
func ResetIngestTraceForRun(root, runID, queueHeadDocumentID, baseRev string) error {
	return WriteTraceForRun(root, runID, IngestTrace{
		RunID:       runID,
		StartedAt:   time.Now().Unix(),
		QueueHeadID: queueHeadDocumentID,
		BaseRev:     strings.TrimSpace(baseRev),
		SourceIDs:   []string{},
		Reads:       []string{},
		Writes:      []string{},
	})
}

// AppendTraceSource records a source id that is not in the raw manifest
// (conversation / memory uploads). Visibility still lives in acl-sources.json.
func AppendTraceSource(root, runID, sourceID string) error {
	sourceID = strings.TrimSpace(sourceID)
	if sourceID == "" {
		return nil
	}
	trace, err := LoadTraceForRun(root, runID)
	if err != nil {
		trace = IngestTrace{RunID: runID, StartedAt: time.Now().Unix()}
	}
	trace.SourceIDs = appendUnique(trace.SourceIDs, sourceID)
	return WriteTraceForRun(root, runID, trace)
}
