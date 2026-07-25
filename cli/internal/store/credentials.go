package store

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"github.com/zalando/go-keyring"
)

const service = "gdg-cli"
const account = "accounts.gdgs.jp"

var ErrNotFound = errors.New("gdg credentials not found")

type Credentials struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
}

type CredentialStore interface {
	Save(Credentials) error
	Load() (Credentials, error)
	Delete() error
}

type credentialStore struct{}

func NewCredentials() CredentialStore { return credentialStore{} }

func (credentialStore) Save(credentials Credentials) error {
	encoded, err := json.Marshal(credentials)
	if err != nil {
		return err
	}
	if err := keyring.Set(service, account, string(encoded)); err == nil {
		return nil
	}
	return writeFallback(encoded)
}

func (credentialStore) Load() (Credentials, error) {
	encoded, err := keyring.Get(service, account)
	if err == nil {
		return decode([]byte(encoded))
	}
	contents, fallbackErr := os.ReadFile(fallbackPath())
	if fallbackErr != nil {
		if errors.Is(fallbackErr, os.ErrNotExist) {
			return Credentials{}, ErrNotFound
		}
		return Credentials{}, fallbackErr
	}
	return decode(contents)
}

func (credentialStore) Delete() error {
	keyringErr := keyring.Delete(service, account)
	fallbackErr := os.Remove(fallbackPath())
	if fallbackErr != nil && !errors.Is(fallbackErr, os.ErrNotExist) {
		return fallbackErr
	}
	if keyringErr != nil && errors.Is(fallbackErr, os.ErrNotExist) {
		return ErrNotFound
	}
	return nil
}

func fallbackPath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return ".gdg-credentials.json"
	}
	return filepath.Join(dir, "gdg", "credentials.json")
}

func writeFallback(contents []byte) error {
	path := fallbackPath()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	return os.WriteFile(path, contents, 0600)
}

func decode(contents []byte) (Credentials, error) {
	var credentials Credentials
	if err := json.Unmarshal(contents, &credentials); err != nil {
		return Credentials{}, err
	}
	if credentials.RefreshToken == "" {
		return Credentials{}, ErrNotFound
	}
	return credentials, nil
}
