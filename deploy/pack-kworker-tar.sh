#!/bin/bash
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
