//go:build !windows

package agenthost

import (
	"os"
	"syscall"
)

func fileOwnerIDs(info os.FileInfo) (int, int, bool) {
	if stat, ok := info.Sys().(*syscall.Stat_t); ok {
		return int(stat.Uid), int(stat.Gid), true
	}
	return 0, 0, false
}
