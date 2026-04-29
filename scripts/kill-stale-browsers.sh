#!/usr/bin/env bash
# Kill stale playwright-mcp sessions and dev servers that may hold Firestore listeners.
# Safe to run at any time — no-ops cleanly when nothing is running.
set -e

pkill -f 'playwright-mcp' 2>/dev/null || true
pkill -f 'vite preview --mode emulator' 2>/dev/null || true

# Kill vite dev servers on the standard ports if they belong to this project.
for port in 5173 5174; do
  pid=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    # Only kill node/vite processes — don't touch unrelated servers on the same port.
    if ps -p "$pid" -o command= 2>/dev/null | grep -qE 'vite|node.*sports-scheduler'; then
      kill "$pid" 2>/dev/null || true
    fi
  fi
done

echo "[kill-stale-browsers] done"
