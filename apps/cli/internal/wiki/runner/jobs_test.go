package runner

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func TestLeaseGenerationBelongsToEachConcurrentJobRequest(t *testing.T) {
	var mu sync.Mutex
	seen := make(map[string]int)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Attempts *int   `json:"attempts"`
			Status   string `json:"status"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Attempts == nil {
			t.Errorf("missing generation in %s: %v", r.URL.Path, err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		want := 0
		if strings.Contains(r.URL.Path, "/retried/") {
			want = 2
		}
		if *body.Attempts != want || r.Header.Get("X-Runner-Host") != "vm" {
			t.Errorf("%s generation=%d host=%s", r.URL.Path, *body.Attempts, r.Header.Get("X-Runner-Host"))
		}
		if strings.HasSuffix(r.URL.Path, "/result") && body.Status != "succeeded" {
			t.Errorf("result status=%q", body.Status)
		}
		mu.Lock()
		seen[r.URL.Path]++
		mu.Unlock()
		fmt.Fprint(w, `{"ok":true}`)
	}))
	defer server.Close()
	api := &API{BaseURL: server.URL, Token: "token", Host: "vm"}
	var workers sync.WaitGroup
	for _, job := range []Job{{ID: "fresh", Attempts: 0}, {ID: "retried", Attempts: 2}} {
		workers.Add(1)
		go func() {
			defer workers.Done()
			if err := api.ExtendLease(context.Background(), job.ID, job.Attempts); err != nil {
				t.Error(err)
			}
		}()
		workers.Add(1)
		go func() {
			defer workers.Done()
			if err := api.Complete(context.Background(), job.ID, job.Attempts, Result{Status: "succeeded"}); err != nil {
				t.Error(err)
			}
		}()
	}
	workers.Wait()
	if len(seen) != 4 {
		t.Fatalf("requests=%v", seen)
	}
}
