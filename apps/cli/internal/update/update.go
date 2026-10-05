package update

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

const releasesURL = "https://api.github.com/repos/gdg-jp/gdgjp/releases?per_page=100"

type release struct {
	TagName    string  `json:"tag_name"`
	Draft      bool    `json:"draft"`
	Prerelease bool    `json:"prerelease"`
	Assets     []asset `json:"assets"`
}

type asset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

func Run(ctx context.Context, output io.Writer, current string, yes bool) error {
	latest, err := latestRelease(ctx)
	if err != nil {
		return err
	}
	if current != "dev" && compareVersions(latest.TagName[4:], current) <= 0 {
		fmt.Fprintln(output, "gdg is already up to date.")
		return nil
	}
	if !yes {
		fmt.Fprintf(output, "Update gdg from %s to %s? [y/N] ", current, latest.TagName[4:])
		var answer string
		if _, err := fmt.Fscan(os.Stdin, &answer); err != nil || !strings.EqualFold(answer, "y") && !strings.EqualFold(answer, "yes") {
			fmt.Fprintln(output, "Update cancelled.")
			return nil
		}
	}
	archive, checksum, err := releaseAssets(latest)
	if err != nil {
		return err
	}
	contents, err := download(ctx, archive.BrowserDownloadURL)
	if err != nil {
		return err
	}
	checksums, err := download(ctx, checksum.BrowserDownloadURL)
	if err != nil {
		return err
	}
	if err := verifyChecksum(archive.Name, contents, checksums); err != nil {
		return err
	}
	if err := replaceExecutable(contents); err != nil {
		return err
	}
	fmt.Fprintf(output, "Updated gdg to %s.\n", latest.TagName[4:])
	return nil
}

func latestRelease(ctx context.Context) (release, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, releasesURL, nil)
	if err != nil {
		return release{}, err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return release{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return release{}, fmt.Errorf("check releases: %s", response.Status)
	}
	var releases []release
	if err := json.NewDecoder(response.Body).Decode(&releases); err != nil {
		return release{}, err
	}
	matching := make([]release, 0, len(releases))
	for _, candidate := range releases {
		if !candidate.Draft && !candidate.Prerelease && validVersion(candidate.TagName) {
			matching = append(matching, candidate)
		}
	}
	if len(matching) == 0 {
		return release{}, errors.New("no stable gdg CLI release was found")
	}
	sort.Slice(matching, func(left, right int) bool {
		return compareVersions(matching[left].TagName[4:], matching[right].TagName[4:]) > 0
	})
	return matching[0], nil
}

func releaseAssets(release release) (asset, asset, error) {
	version := strings.TrimPrefix(release.TagName, "cli/v")
	archiveName := fmt.Sprintf("gdg_%s_%s_%s.zip", version, runtime.GOOS, runtime.GOARCH)
	var archive, checksums asset
	for _, candidate := range release.Assets {
		if candidate.Name == archiveName {
			archive = candidate
		}
		if candidate.Name == "checksums.txt" {
			checksums = candidate
		}
	}
	if archive.BrowserDownloadURL == "" || checksums.BrowserDownloadURL == "" {
		return asset{}, asset{}, fmt.Errorf("release %s does not contain %s and checksums.txt", release.TagName, archiveName)
	}
	return archive, checksums, nil
}

func download(ctx context.Context, rawURL string) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download %s: %s", rawURL, response.Status)
	}
	return io.ReadAll(io.LimitReader(response.Body, 128<<20))
}

func verifyChecksum(name string, contents, checksums []byte) error {
	sum := sha256.Sum256(contents)
	expected := ""
	scanner := bufio.NewScanner(bytes.NewReader(checksums))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) >= 2 && strings.TrimPrefix(fields[len(fields)-1], "*") == name {
			expected = fields[0]
			break
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	if expected == "" || !strings.EqualFold(expected, hex.EncodeToString(sum[:])) {
		return errors.New("download checksum did not match the release manifest")
	}
	return nil
}

func replaceExecutable(archive []byte) error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	binary := "gdg"
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}
	reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		return err
	}
	for _, file := range reader.File {
		if filepath.Base(file.Name) != binary {
			continue
		}
		contents, err := file.Open()
		if err != nil {
			return err
		}
		defer contents.Close()
		temporary := executable + ".new"
		if err := writeExecutable(temporary, contents); err != nil {
			return err
		}
		if runtime.GOOS == "windows" {
			command := exec.Command("cmd", "/C", "ping 127.0.0.1 -n 2 > nul & move /Y \""+temporary+"\" \""+executable+"\"")
			if err := command.Start(); err != nil {
				return fmt.Errorf("schedule Windows replacement: %w", err)
			}
			return nil
		}
		if err := os.Rename(temporary, executable); err != nil {
			return fmt.Errorf("replace %s: %w (run the install command again if this directory is not writable)", executable, err)
		}
		return nil
	}
	return errors.New("release archive did not contain the gdg executable")
}

func writeExecutable(path string, contents io.Reader) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(file, contents)
	closeErr := file.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}

func validVersion(tag string) bool {
	if !strings.HasPrefix(tag, "cli/v") {
		return false
	}
	parts := strings.Split(strings.TrimPrefix(tag, "cli/v"), ".")
	if len(parts) != 3 {
		return false
	}
	for _, part := range parts {
		if part == "" || strings.Trim(part, "0123456789") != "" {
			return false
		}
	}
	return true
}

func compareVersions(left, right string) int {
	leftParts := strings.Split(strings.TrimPrefix(left, "v"), ".")
	rightParts := strings.Split(strings.TrimPrefix(right, "v"), ".")
	for index := 0; index < 3; index++ {
		var leftNumber, rightNumber int
		fmt.Sscanf(leftParts[index], "%d", &leftNumber)
		fmt.Sscanf(rightParts[index], "%d", &rightNumber)
		if leftNumber > rightNumber {
			return 1
		}
		if leftNumber < rightNumber {
			return -1
		}
	}
	return 0
}
