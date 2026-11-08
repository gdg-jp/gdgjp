package discordgw

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
)

const botID = "1535835155774709880"

type fakeDiscord struct {
	t        *testing.T
	url      string
	mu       sync.Mutex
	opens    []map[string]any // the Identify or Resume each connection sent
	forwards []Message
	auth     []string
	done     chan struct{}
}

func (f *fakeDiscord) gateway(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer conn.CloseNow()
	ctx := r.Context()
	write := func(op int, t string, s int64, d any) {
		raw, _ := json.Marshal(d)
		msg := map[string]any{"op": op, "d": json.RawMessage(raw)}
		if t != "" {
			msg["t"], msg["s"] = t, s
		}
		data, _ := json.Marshal(msg)
		_ = conn.Write(ctx, websocket.MessageText, data)
	}
	write(10, "", 0, map[string]any{"heartbeat_interval": 60_000})
	_, data, err := conn.Read(ctx)
	if err != nil {
		return
	}
	var open map[string]any
	_ = json.Unmarshal(data, &open)
	f.mu.Lock()
	f.opens = append(f.opens, open)
	n := len(f.opens)
	f.mu.Unlock()

	mention := map[string]any{"id": botID}
	person := map[string]any{"id": "u1"}
	if n == 1 {
		write(0, "READY", 1, map[string]any{
			"session_id": "sess1", "resume_gateway_url": f.url,
			"user": map[string]any{"id": botID, "username": "GDG Agent"}, "guilds": []any{},
		})
		// Forwarded: a mention in a guild, and a DM.
		write(0, "MESSAGE_CREATE", 2, map[string]any{
			"id": "m1", "channel_id": "c1", "guild_id": "g1", "author": person,
			"content": "<@" + botID + "> 会場は？", "mentions": []any{mention},
		})
		write(0, "MESSAGE_CREATE", 3, map[string]any{
			"id": "m2", "channel_id": "dm", "author": person, "content": "DM の質問", "mentions": []any{},
		})
		// Not forwarded: no mention, and another bot mentioning us.
		write(0, "MESSAGE_CREATE", 4, map[string]any{
			"id": "m3", "channel_id": "c1", "guild_id": "g1", "author": person, "mentions": []any{},
		})
		write(0, "MESSAGE_CREATE", 5, map[string]any{
			"id": "m4", "channel_id": "c1", "guild_id": "g1",
			"author": map[string]any{"id": "b", "bot": true}, "mentions": []any{mention},
		})
		write(7, "", 0, nil) // Reconnect: the client must resume
	} else {
		write(0, "RESUMED", 6, map[string]any{})
		close(f.done)
	}
	_, _, _ = conn.Read(ctx)
}

func (f *fakeDiscord) agent(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var m Message
	_ = json.Unmarshal(body, &m)
	f.mu.Lock()
	f.forwards = append(f.forwards, m)
	f.auth = append(f.auth, r.Header.Get("authorization"))
	f.mu.Unlock()
	w.WriteHeader(http.StatusAccepted)
}

func TestGatewayIdentifiesOnlineForwardsMentionsAndResumes(t *testing.T) {
	f := &fakeDiscord{t: t, done: make(chan struct{})}
	gw := httptest.NewServer(http.HandlerFunc(f.gateway))
	defer gw.Close()
	agent := httptest.NewServer(http.HandlerFunc(f.agent))
	defer agent.Close()
	f.url = "ws" + strings.TrimPrefix(gw.URL, "http")

	g, err := New(Config{
		BotToken: "bot-token", ForwardToken: "fwd-token", ForwardURL: agent.URL,
		GatewayURL: f.url, Logger: log.New(io.Discard, "", 0), MaxBackoff: 10 * time.Millisecond,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	go func() {
		select {
		case <-f.done:
			time.Sleep(100 * time.Millisecond) // let the forwards land
			cancel()
		case <-ctx.Done():
		}
	}()
	if err := g.Run(ctx); err != context.Canceled {
		t.Fatalf("Run: %v", err)
	}

	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.opens) != 2 {
		t.Fatalf("connections = %d, want 2", len(f.opens))
	}
	if op := f.opens[0]["op"]; op != float64(2) {
		t.Fatalf("first connection sent op %v, want Identify", op)
	}
	identify := f.opens[0]["d"].(map[string]any)
	if identify["intents"] != float64(Intents) || identify["token"] != "bot-token" {
		t.Fatalf("identify = %v", identify)
	}
	if status := identify["presence"].(map[string]any)["status"]; status != "online" {
		t.Fatalf("presence status = %v", status)
	}
	if op := f.opens[1]["op"]; op != float64(6) {
		t.Fatalf("second connection sent op %v, want Resume", op)
	}
	resume := f.opens[1]["d"].(map[string]any)
	if resume["session_id"] != "sess1" || resume["seq"] != float64(5) {
		t.Fatalf("resume = %v", resume)
	}
	ids := map[string]bool{}
	for i, m := range f.forwards {
		ids[m.ID] = true
		if f.auth[i] != "Bearer fwd-token" {
			t.Fatalf("forward auth = %q", f.auth[i])
		}
	}
	if len(f.forwards) != 2 || !ids["m1"] || !ids["m2"] {
		t.Fatalf("forwarded %v, want m1 and m2 only", ids)
	}
}

func TestBadTokenIsFatal(t *testing.T) {
	gw := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		_ = conn.Write(r.Context(), websocket.MessageText, []byte(`{"op":10,"d":{"heartbeat_interval":60000}}`))
		_, _, _ = conn.Read(r.Context())
		conn.Close(4004, "Authentication failed.")
	}))
	defer gw.Close()
	g, _ := New(Config{
		BotToken: "bad", ForwardToken: "x", GatewayURL: "ws" + strings.TrimPrefix(gw.URL, "http"),
		Logger: log.New(io.Discard, "", 0),
	})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := g.Run(ctx); err == nil || !strings.Contains(err.Error(), "4004") {
		t.Fatalf("Run = %v, want a fatal 4004", err)
	}
}
