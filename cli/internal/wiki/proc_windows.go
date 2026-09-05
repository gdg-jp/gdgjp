//go:build windows

package wiki

import (
	"os"

	"golang.org/x/sys/windows"
)

func osLockFile(f *os.File) error {
	var ov windows.Overlapped
	flags := uint32(windows.LOCKFILE_EXCLUSIVE_LOCK | windows.LOCKFILE_FAIL_IMMEDIATELY)
	return windows.LockFileEx(windows.Handle(f.Fd()), flags, 0, 1, 0, &ov)
}

func osUnlockFile(f *os.File) error {
	var ov windows.Overlapped
	return windows.UnlockFileEx(windows.Handle(f.Fd()), 0, 1, 0, &ov)
}
