package wiki

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const TraceFileName = "ingest-trace.json"

// IngestTrace records files touched during one ingest agent run.
//
// Reads expand the set of sources that need tagging (never shrink it).
// Writes are audit-only for the pre-push gate — changed pages come from git.
// After a successful push the git diff is empty, so VerifyACL recovers the
// submitted page set from tip/recent commits (CollectCommittedPageRels) and
// may also use Writes for Cursor afterFileEdit (PageRelsFromTraceWrites).
// Writes must still never replace or shrink the read-source set.
type IngestTrace struct {
	RunID       string   `json:"runId"`
	StartedAt   int64    `json:"startedAt"`
	QueueHeadID string   `json:"queueHeadDocumentId"`
	Reads       []string `json:"reads"`
	Writes      []string `json:"writes"`
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
func ResetIngestTrace(root, queueHeadDocumentID string) error {
	return WriteTrace(root, IngestTrace{
		RunID:       newRunID(),
		StartedAt:   time.Now().Unix(),
		QueueHeadID: queueHeadDocumentID,
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
