//go:build windows

package agenthost

import "os"

func fileOwnerIDs(info os.FileInfo) (int, int, bool) {
	return 0, 0, false
}
