// Package discordgw keeps the GDG Agent bot connected to the Discord Gateway.
//
// gdgjp-agent (a Cloudflare Worker) answers slash commands over HTTP, but Discord shows a bot
// as online, and delivers ordinary messages, only to a client holding a Gateway WebSocket. A
// Worker cannot hold one cheaply, so `gdg agent discord-gateway` runs next to the runners on
// the OCI VM: it identifies with an online presence and forwards @mentions and DMs to
// https://agent.gdgs.jp/internal/discord-message. It never answers anything itself.
package discordgw

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/rand/v2"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
)

const (
	DefaultGatewayURL = "wss://gateway.discord.gg"
	DefaultAgentURL   = "https://agent.gdgs.jp"

	// GUILD_MESSAGES | DIRECT_MESSAGES. No privileged Message Content intent: Discord still
	// fills `content` for messages that mention the app and for DMs, the only ones we forward.
	Intents = 1<<9 | 1<<12

	// DefaultStatus is the custom status shown under the bot's name.
	DefaultStatus = "/ask か @メンションで wiki に質問"
)

// Config comes from /etc/gdg/discord-gateway.env on the VM; see infra/oci-runner/README.md.
type Config struct {
	BotToken     string
	ForwardURL   string
	ForwardToken string
	GatewayURL   string
	Status       string
	HTTP         *http.Client
	Logger       *log.Logger
	// MaxBackoff caps the wait between reconnects (tests shorten it).
	MaxBackoff time.Duration
}

func ConfigFromEnv() Config {
	agent := strings.TrimRight(envOr("AGENT_URL", DefaultAgentURL), "/")
	return Config{
		BotToken:     os.Getenv("DISCORD_BOT_TOKEN"),
		ForwardURL:   agent + "/internal/discord-message",
		ForwardToken: os.Getenv("GATEWAY_TOKEN"),
		GatewayURL:   envOr("DISCORD_GATEWAY_URL", DefaultGatewayURL),
		Status:       envOr("DISCORD_STATUS", DefaultStatus),
	}
}

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

// Message is the part of MESSAGE_CREATE the agent Worker reads.
type Message struct {
	ID        string `json:"id"`
	ChannelID string `json:"channel_id"`
	GuildID   string `json:"guild_id,omitempty"`
	WebhookID string `json:"webhook_id,omitempty"`
	Author    *struct {
		ID  string `json:"id"`
		Bot bool   `json:"bot,omitempty"`
	} `json:"author,omitempty"`
	Content  string `json:"content"`
	Mentions []struct {
		ID string `json:"id"`
	} `json:"mentions"`
}

// ForBot reports whether the agent should see this message: a person's DM to the bot, or a
// guild message that mentions it. The Worker applies the same rule again.
func (m Message) ForBot(botID string) bool {
	if m.Author == nil || m.Author.Bot || m.WebhookID != "" || botID == "" {
		return false
	}
	if m.GuildID == "" {
		return true
	}
	for _, u := range m.Mentions {
		if u.ID == botID {
			return true
		}
	}
	return false
}

type payload struct {
	Op int             `json:"op"`
	D  json.RawMessage `json:"d,omitempty"`
	S  *int64          `json:"s,omitempty"`
	T  string          `json:"t,omitempty"`
}

// errFatal ends Run: retrying cannot help (bad token, intents not allowed).
type errFatal struct{ error }

// Gateway holds the session that survives reconnects (Resume).
type Gateway struct {
	cfg       Config
	sessionID string
	resumeURL string
	botID     string
	seq       atomic.Int64
	wg        sync.WaitGroup
}

func New(cfg Config) (*Gateway, error) {
	if cfg.BotToken == "" {
		return nil, errors.New("DISCORD_BOT_TOKEN is not set")
	}
	if cfg.ForwardToken == "" {
		return nil, errors.New("GATEWAY_TOKEN is not set (it must equal the agent Worker's secret)")
	}
	if cfg.ForwardURL == "" {
		cfg.ForwardURL = DefaultAgentURL + "/internal/discord-message"
	}
	if cfg.GatewayURL == "" {
		cfg.GatewayURL = DefaultGatewayURL
	}
	if cfg.Status == "" {
		cfg.Status = DefaultStatus
	}
	if cfg.HTTP == nil {
		cfg.HTTP = &http.Client{Timeout: 20 * time.Second}
	}
	if cfg.Logger == nil {
		cfg.Logger = log.New(os.Stderr, "", log.LstdFlags)
	}
	if cfg.MaxBackoff == 0 {
		cfg.MaxBackoff = time.Minute
	}
	return &Gateway{cfg: cfg}, nil
}

// Run connects, and reconnects (resuming when it can), until ctx ends or a fatal close.
func (g *Gateway) Run(ctx context.Context) error {
	defer g.wg.Wait()
	backoff := time.Second
	for {
		started := time.Now()
		err := g.session(ctx)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		var fatal errFatal
		if errors.As(err, &fatal) {
			return fatal.error
		}
		if time.Since(started) > time.Minute {
			backoff = time.Second
		}
		g.cfg.Logger.Printf("gateway: disconnected (%v); reconnecting in %s", err, backoff)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, g.cfg.MaxBackoff)
	}
}

func (g *Gateway) session(ctx context.Context) error {
	base := g.cfg.GatewayURL
	resuming := g.sessionID != "" && g.resumeURL != ""
	if resuming {
		base = g.resumeURL
	}
	conn, _, err := websocket.Dial(ctx, strings.TrimRight(base, "/")+"/?v=10&encoding=json", nil)
	if err != nil {
		return err
	}
	defer conn.CloseNow()
	conn.SetReadLimit(32 << 20) // READY lists every guild

	hello, err := read(ctx, conn)
	if err != nil {
		return err
	}
	if hello.Op != 10 {
		return fmt.Errorf("expected Hello, got op %d", hello.Op)
	}
	var h struct {
		HeartbeatInterval int64 `json:"heartbeat_interval"`
	}
	if err := json.Unmarshal(hello.D, &h); err != nil || h.HeartbeatInterval <= 0 {
		return fmt.Errorf("bad Hello: %s", hello.D)
	}

	sctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var acked atomic.Bool
	acked.Store(true)
	beat := make(chan struct{}, 1)
	heartbeatErr := make(chan error, 1)
	go func() {
		heartbeatErr <- g.heartbeat(sctx, conn, time.Duration(h.HeartbeatInterval)*time.Millisecond, &acked, beat)
	}()

	if resuming {
		err = send(ctx, conn, 6, map[string]any{
			"token": g.cfg.BotToken, "session_id": g.sessionID, "seq": g.seq.Load(),
		})
	} else {
		err = send(ctx, conn, 2, g.identify())
	}
	if err != nil {
		return err
	}

	for {
		p, err := read(sctx, conn)
		if err != nil {
			select {
			case herr := <-heartbeatErr:
				if herr != nil {
					return herr
				}
			default:
			}
			return g.closeError(err)
		}
		if p.S != nil {
			g.seq.Store(*p.S)
		}
		switch p.Op {
		case 0:
			g.dispatch(ctx, p)
		case 1:
			select {
			case beat <- struct{}{}:
			default:
			}
		case 7:
			conn.Close(4000, "reconnect requested")
			return errors.New("server asked to reconnect")
		case 9:
			var resumable bool
			_ = json.Unmarshal(p.D, &resumable)
			if !resumable {
				g.sessionID, g.resumeURL = "", ""
			}
			conn.Close(4000, "invalid session")
			// Discord asks for 1–5 s before identifying again.
			time.Sleep(time.Second + time.Duration(rand.Int64N(int64(4*time.Second))))
			return errors.New("invalid session")
		case 11:
			acked.Store(true)
		}
	}
}

func (g *Gateway) identify() map[string]any {
	return map[string]any{
		"token":   g.cfg.BotToken,
		"intents": Intents,
		"properties": map[string]string{
			"os": "linux", "browser": "gdg-agent-gateway", "device": "gdg-agent-gateway",
		},
		"presence": map[string]any{
			"since":  nil,
			"afk":    false,
			"status": "online",
			"activities": []map[string]any{
				{"name": "Custom Status", "type": 4, "state": g.cfg.Status},
			},
		},
	}
}

func (g *Gateway) heartbeat(
	ctx context.Context,
	conn *websocket.Conn,
	interval time.Duration,
	acked *atomic.Bool,
	beat <-chan struct{},
) error {
	// The first beat waits interval * jitter, as the Gateway documentation asks.
	timer := time.NewTimer(time.Duration(rand.Float64() * float64(interval)))
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-beat:
		case <-timer.C:
			if !acked.Load() {
				// A zombied connection: drop it and resume on a fresh one.
				conn.Close(4000, "heartbeat not acknowledged")
				return errors.New("heartbeat not acknowledged")
			}
			timer.Reset(interval)
		}
		acked.Store(false)
		seq := g.seq.Load()
		var d any
		if seq > 0 {
			d = seq
		}
		if err := send(ctx, conn, 1, d); err != nil {
			return nil // the read loop sees the broken connection
		}
	}
}

func (g *Gateway) dispatch(ctx context.Context, p payload) {
	switch p.T {
	case "READY":
		var r struct {
			SessionID        string `json:"session_id"`
			ResumeGatewayURL string `json:"resume_gateway_url"`
			User             struct {
				ID       string `json:"id"`
				Username string `json:"username"`
			} `json:"user"`
			Guilds []json.RawMessage `json:"guilds"`
		}
		if err := json.Unmarshal(p.D, &r); err != nil {
			g.cfg.Logger.Printf("gateway: bad READY: %v", err)
			return
		}
		g.sessionID, g.resumeURL, g.botID = r.SessionID, r.ResumeGatewayURL, r.User.ID
		g.cfg.Logger.Printf("gateway: ready as %s (%s), %d guilds", r.User.Username, r.User.ID, len(r.Guilds))
	case "RESUMED":
		g.cfg.Logger.Printf("gateway: resumed at seq %d", g.seq.Load())
	case "MESSAGE_CREATE":
		var m Message
		if err := json.Unmarshal(p.D, &m); err != nil || !m.ForBot(g.botID) {
			return
		}
		g.wg.Add(1)
		go func() {
			defer g.wg.Done()
			if err := g.forward(context.WithoutCancel(ctx), m); err != nil {
				g.cfg.Logger.Printf("gateway: forward message %s failed: %v", m.ID, err)
				return
			}
			g.cfg.Logger.Printf("gateway: forwarded message %s (guild %q)", m.ID, m.GuildID)
		}()
	}
}

func (g *Gateway) forward(ctx context.Context, m Message) error {
	body, err := json.Marshal(m)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.cfg.ForwardURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("authorization", "Bearer "+g.cfg.ForwardToken)
	req.Header.Set("content-type", "application/json")
	res, err := g.cfg.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return fmt.Errorf("agent returned %d", res.StatusCode)
	}
	return nil
}

// closeError maps Gateway close codes: some end the process, some forbid resuming.
func (g *Gateway) closeError(err error) error {
	code := websocket.CloseStatus(err)
	switch code {
	case 4004:
		return errFatal{errors.New("gateway closed 4004: DISCORD_BOT_TOKEN is wrong or was reset")}
	case 4010, 4011, 4012, 4013, 4014:
		return errFatal{fmt.Errorf("gateway closed %d: check intents and the bot's settings", code)}
	case 4007, 4009:
		g.sessionID, g.resumeURL = "", ""
	}
	return err
}

func read(ctx context.Context, conn *websocket.Conn) (payload, error) {
	_, data, err := conn.Read(ctx)
	if err != nil {
		return payload{}, err
	}
	var p payload
	if err := json.Unmarshal(data, &p); err != nil {
		return payload{}, fmt.Errorf("bad gateway payload: %w", err)
	}
	return p, nil
}

func send(ctx context.Context, conn *websocket.Conn, op int, d any) error {
	data, err := json.Marshal(map[string]any{"op": op, "d": d})
	if err != nil {
		return err
	}
	wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return conn.Write(wctx, websocket.MessageText, data)
}
