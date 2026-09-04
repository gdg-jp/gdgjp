package agenthost

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/user"
	"path/filepath"
	"strings"
	"syscall"

	"golang.org/x/term"
)

// SecretsStatus audits and prints the status of required secrets on the host.
func SecretsStatus(slotCount int) error {
	if slotCount < 1 {
		slotCount = 4
	}

	fmt.Println("==> GDG Agent Host Secrets Status:")

	var missing []string

	// 1. gdg credentials
	gdgCred := "/home/gdgagent-svc/.config/gdg/credentials.json"
	if fi, err := os.Stat(gdgCred); err == nil && fi.Size() > 0 {
		fmt.Printf("  [OK] gdg credentials present (%s)\n", gdgCred)
	} else {
		fmt.Printf("  [MISSING] gdg credentials (%s)\n", gdgCred)
		missing = append(missing, "gdg credentials (run 'sudo gdg agent-host secrets login')")
	}

	// 2. Discord token
	xangiSecrets := "/home/gdgagent-svc/.config/xangi/secrets.json"
	discordOk := false
	if data, err := os.ReadFile(xangiSecrets); err == nil {
		var sec map[string]any
		if json.Unmarshal(data, &sec) == nil {
			if tok, ok := sec["DISCORD_TOKEN"].(string); ok && strings.TrimSpace(tok) != "" {
				discordOk = true
			}
		}
	}
	if discordOk {
		fmt.Printf("  [OK] Discord bot token configured (%s)\n", xangiSecrets)
	} else {
		fmt.Printf("  [MISSING] Discord bot token in %s\n", xangiSecrets)
		missing = append(missing, "Discord bot token (run 'sudo gdg agent-host secrets set discord')")
	}

	// 3. Cursor auth.json
	var missingSlots []int
	for slot := 0; slot < slotCount; slot++ {
		slotAuth := fmt.Sprintf("/home/gdgagent-run-%d/.config/cursor/auth.json", slot)
		if fi, err := os.Stat(slotAuth); err != nil || fi.Size() == 0 {
			missingSlots = append(missingSlots, slot)
		}
	}
	if len(missingSlots) == 0 {
		fmt.Printf("  [OK] Cursor auth.json present on all %d slot accounts\n", slotCount)
	} else {
		fmt.Printf("  [MISSING] Cursor auth.json missing on slots: %v\n", missingSlots)
		missing = append(missing, "Cursor auth.json (run 'sudo gdg agent-host secrets import --from-operator')")
	}

	// 4. Langfuse credentials (optional)
	lfCred := "/home/gdgagent-svc/.config/langfuse/credentials.json"
	if fi, err := os.Stat(lfCred); err == nil && fi.Size() > 0 {
		fmt.Printf("  [OK] Langfuse observability credentials present (%s)\n", lfCred)
	} else {
		fmt.Printf("  [OPTIONAL] Langfuse credentials not configured (%s)\n", lfCred)
	}

	if len(missing) > 0 {
		fmt.Println("\nActions needed to activate service:")
		for _, m := range missing {
			fmt.Printf("  - %s\n", m)
		}
	} else {
		fmt.Println("\nAll required host secrets are configured.")
	}

	return nil
}

// SecretsImportFromOperator copies secrets from $SUDO_USER's home directory.
func SecretsImportFromOperator(slotCount int) error {
	sudoUser := os.Getenv("SUDO_USER")
	if sudoUser == "" || sudoUser == "root" {
		fmt.Println("Notice: SUDO_USER is empty or root; cannot determine operator home directory.")
		return nil
	}

	u, err := user.Lookup(sudoUser)
	if err != nil {
		return fmt.Errorf("lookup SUDO_USER %q: %w", sudoUser, err)
	}

	opHome := u.HomeDir
	if slotCount < 1 {
		slotCount = 4
	}

	// Copy gdg credentials
	opGdg := filepath.Join(opHome, ".config", "gdg", "credentials.json")
	if fi, err := os.Stat(opGdg); err == nil && fi.Size() > 0 {
		dest := "/home/gdgagent-svc/.config/gdg/credentials.json"
		if err := copySecretFile(opGdg, dest, "gdgagent-svc", "gdgagent-svc"); err != nil {
			fmt.Printf("warning: copying gdg credentials failed: %v\n", err)
		} else {
			fmt.Printf("==> copied gdg credentials from %s to %s\n", sudoUser, dest)
		}
	}

	// Copy xangi secrets
	opXangi := filepath.Join(opHome, ".config", "xangi", "secrets.json")
	if fi, err := os.Stat(opXangi); err == nil && fi.Size() > 0 {
		dest := "/home/gdgagent-svc/.config/xangi/secrets.json"
		if err := copySecretFile(opXangi, dest, "gdgagent-svc", "gdgagent-svc"); err != nil {
			fmt.Printf("warning: copying xangi secrets failed: %v\n", err)
		} else {
			fmt.Printf("==> copied xangi secrets from %s to %s\n", sudoUser, dest)
		}
	}

	// Copy cursor auth.json to all slots
	opCursor := filepath.Join(opHome, ".config", "cursor", "auth.json")
	if fi, err := os.Stat(opCursor); err == nil && fi.Size() > 0 {
		for slot := 0; slot < slotCount; slot++ {
			slotUser := fmt.Sprintf("gdgagent-run-%d", slot)
			dest := fmt.Sprintf("/home/%s/.config/cursor/auth.json", slotUser)
			if err := copySecretFile(opCursor, dest, slotUser, slotUser); err != nil {
				fmt.Printf("warning: copying cursor auth.json to %s failed: %v\n", slotUser, err)
			}
		}
		fmt.Printf("==> copied Cursor auth.json from %s to all %d slot accounts\n", sudoUser, slotCount)
	}

	// Copy langfuse credentials
	opLf := filepath.Join(opHome, ".config", "langfuse", "credentials.json")
	if fi, err := os.Stat(opLf); err == nil && fi.Size() > 0 {
		dest := "/home/gdgagent-svc/.config/langfuse/credentials.json"
		if err := copySecretFile(opLf, dest, "gdgagent-svc", "gdgagent-svc"); err != nil {
			fmt.Printf("warning: copying langfuse credentials failed: %v\n", err)
		} else {
			fmt.Printf("==> copied langfuse credentials from %s to %s\n", sudoUser, dest)
		}
	}

	return nil
}

// SecretsSetDiscord interactively prompts for DISCORD_TOKEN.
func SecretsSetDiscord() error {
	fmt.Print("DISCORD_TOKEN (input hidden): ")
	byteToken, err := term.ReadPassword(int(syscall.Stdin))
	fmt.Println()
	if err != nil {
		return err
	}

	token := strings.TrimSpace(string(byteToken))
	if token == "" {
		return fmt.Errorf("DISCORD_TOKEN cannot be empty")
	}

	dest := "/home/gdgagent-svc/.config/xangi/secrets.json"
	sec := make(map[string]any)
	if existing, err := os.ReadFile(dest); err == nil {
		_ = json.Unmarshal(existing, &sec)
	}
	sec["DISCORD_TOKEN"] = token

	data, err := json.MarshalIndent(sec, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')

	_ = os.MkdirAll(filepath.Dir(dest), 0o700)
	if err := os.WriteFile(dest, data, 0o600); err != nil {
		return err
	}
	if os.Getuid() == 0 {
		_ = chownPath(dest, "gdgagent-svc", "gdgagent-svc")
		_ = chownPath(filepath.Dir(dest), "gdgagent-svc", "gdgagent-svc")
	}

	fmt.Printf("==> Saved DISCORD_TOKEN to %s\n", dest)
	return nil
}

// SecretsSetLangfuse interactively prompts for Langfuse credentials.
func SecretsSetLangfuse() error {
	reader := bufio.NewReader(os.Stdin)

	fmt.Print("LANGFUSE_PUBLIC_KEY (pk-lf-...): ")
	pubKey, err := reader.ReadString('\n')
	if err != nil {
		return err
	}
	pubKey = strings.TrimSpace(pubKey)

	fmt.Print("LANGFUSE_SECRET_KEY (sk-lf-..., input hidden): ")
	byteSecret, err := term.ReadPassword(int(syscall.Stdin))
	fmt.Println()
	if err != nil {
		return err
	}
	secretKey := strings.TrimSpace(string(byteSecret))

	fmt.Print("LANGFUSE_HOST [https://jp.cloud.langfuse.com]: ")
	host, err := reader.ReadString('\n')
	if err != nil {
		return err
	}
	host = strings.TrimSpace(host)
	if host == "" {
		host = "https://jp.cloud.langfuse.com"
	}

	fmt.Print("idSalt (random string for hashing ids; blank = auto-generate): ")
	idSalt, err := reader.ReadString('\n')
	if err != nil {
		return err
	}
	idSalt = strings.TrimSpace(idSalt)
	if idSalt == "" {
		buf := make([]byte, 32)
		_, _ = rand.Read(buf)
		idSalt = hex.EncodeToString(buf)
		fmt.Println("  (generated idSalt)")
	}

	if pubKey == "" || secretKey == "" {
		return fmt.Errorf("LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are required")
	}

	payload := map[string]string{
		"LANGFUSE_PUBLIC_KEY": pubKey,
		"LANGFUSE_SECRET_KEY": secretKey,
		"LANGFUSE_HOST":       host,
		"idSalt":              idSalt,
	}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')

	dest := "/home/gdgagent-svc/.config/langfuse/credentials.json"
	_ = os.MkdirAll(filepath.Dir(dest), 0o700)
	if err := os.WriteFile(dest, data, 0o600); err != nil {
		return err
	}
	if os.Getuid() == 0 {
		_ = chownPath(dest, "gdgagent-svc", "gdgagent-svc")
		_ = chownPath(filepath.Dir(dest), "gdgagent-svc", "gdgagent-svc")
	}

	fmt.Printf("==> Wrote %s\n", dest)
	return nil
}

// SecretsLogin invokes `gdg login --device` as the `gdgagent-svc` user.
func SecretsLogin() error {
	fmt.Println("==> gdg login --device (gdgagent-svc)")
	return runAsUser("gdgagent-svc", "/usr/local/bin/gdg", "login", "--device")
}

func copySecretFile(src, dest, owner, group string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	dir := filepath.Dir(dest)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(dest, data, 0o600); err != nil {
		return err
	}
	if os.Getuid() == 0 {
		_ = chownPath(dir, owner, group)
		_ = chownPath(dest, owner, group)
	}
	return nil
}
