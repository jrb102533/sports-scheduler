#!/usr/bin/env bash
# Kill stale playwright-mcp sessions and dev servers that may hold Firestore listeners.
# Safe to run at any time — no-ops cleanly when nothing is running.
set -e

pkill -f 'playwright-mcp' 2>/dev/null || true
pkill -f 'vite preview --mode emulator' 2>/dev/null || true

# Kill vite dev servers on the standard ports if they belong to this project.
# lsof can return multiple PIDs (one per line) if more than one process holds the port —
# loop over each PID individually so we don't pass a multi-line string to ps/kill.
for port in 5173 5174; do
  while IFS= read -r single_pid; do
    [ -z "$single_pid" ] && continue
    # Only kill node/vite processes — don't touch unrelated servers on the same port.
    if ps -p "$single_pid" -o command= 2>/dev/null | grep -qE 'vite|node.*sports-scheduler'; then
      kill "$single_pid" 2>/dev/null || true
    fi
  done < <(lsof -ti :"$port" 2>/dev/null || true)
done

echo "[kill-stale-browsers] done"
