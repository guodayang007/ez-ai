#!/usr/bin/env bash
# Restart the local ez-ai dev stack: Go backend (:3000), Rsbuild dev server
# (:5174) and, when it is set up, the DogPay fulfiller (:3100).
#
#   scripts/dev-restart.sh               build the backend, then restart everything
#   scripts/dev-restart.sh --if-changed  same, but skip when the code has not changed
#                                        since the last successful restart (Claude Code Stop hook)
#   scripts/dev-restart.sh stop          stop everything
#   scripts/dev-restart.sh status        show what is running
#
# Logs, pid files and the change fingerprint live in logs/dev/ (git-ignored).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT/logs/dev"
FULFILLER_DIR="$ROOT/services/dogpay-fulfiller"
BACKEND_PORT=3000
WEB_PORT=5174
FULFILLER_PORT="$(sed -n 's/^PORT=//p' "$FULFILLER_DIR/.env" 2>/dev/null | tail -1)"
FULFILLER_PORT="${FULFILLER_PORT:-3100}"

mkdir -p "$RUN_DIR"
cd "$ROOT" || exit 1

MODE=restart
HOOK=0
STOP_HOOK_ACTIVE=0
for arg in "$@"; do
  case "$arg" in
    --if-changed) HOOK=1 ;;
    stop | status) MODE="$arg" ;;
    *) echo "unknown argument: $arg" >&2; exit 1 ;;
  esac
done

# In hook mode stdout must stay clean for the hook's JSON reply; progress goes to the log.
if [[ $HOOK == 1 ]]; then
  if [[ ! -t 0 ]] && grep -q '"stop_hook_active": *true'; then STOP_HOOK_ACTIVE=1; fi
  LOG_START=$(($(wc -l <"$RUN_DIR/restart.log" 2>/dev/null || echo 0) + 1))
  exec 3>&1 4>&2 >>"$RUN_DIR/restart.log" 2>&1
  echo "=== $(date '+%F %T') hook restart"
fi

log() { echo "[dev-restart] $*"; }

# Content hash of the working tree (HEAD, tracked diffs, untracked files, .env files).
fingerprint() {
  {
    git rev-parse HEAD
    git diff HEAD --binary
    git ls-files -o --exclude-standard | git hash-object --stdin-paths
    cat .env "$FULFILLER_DIR/.env" 2>/dev/null
  } | shasum | cut -d' ' -f1
}

listening_pids() { lsof -nP -t -iTCP:"$1" -sTCP:LISTEN 2>/dev/null; }
pid_cwd() { lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p'; }

# Stop the process group we started, then anything of this repo still holding the port.
stop_service() {
  local name=$1 port=$2 pidfile="$RUN_DIR/$1.pid" pid
  if [[ -f $pidfile ]]; then
    pid=$(cat "$pidfile")
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
    rm -f "$pidfile"
  fi
  for pid in $(listening_pids "$port"); do
    if [[ $(pid_cwd "$pid") == "$ROOT"* ]]; then
      kill -TERM "$pid" 2>/dev/null
    else
      log "port $port is used by pid $pid outside this repo; not touching it"
      return 1
    fi
  done
  for _ in $(seq 50); do
    [[ -z $(listening_pids "$port") ]] && { log "$name stopped"; return 0; }
    sleep 0.2
  done
  for pid in $(listening_pids "$port"); do kill -KILL "$pid" 2>/dev/null; done
  log "$name killed"
}

# Start in its own process group (set -m) so a later stop takes child processes too.
start_service() {
  local name=$1 dir=$2
  shift 2
  set -m
  (cd "$dir" && exec nohup "$@" >"$RUN_DIR/$name.log" 2>&1 </dev/null) &
  echo $! >"$RUN_DIR/$name.pid"
  set +m
  log "$name starting (log: logs/dev/$name.log)"
}

# Wait until the URL answers with any HTTP status.
wait_http() {
  local name=$1 url=$2 seconds=$3 code
  for _ in $(seq $((seconds * 2))); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$url")
    [[ $code != 000 ]] && { log "$name up: $url"; return 0; }
    if [[ -f $RUN_DIR/$name.pid ]] && ! kill -0 "$(cat "$RUN_DIR/$name.pid")" 2>/dev/null; then
      break
    fi
    sleep 0.5
  done
  log "$name did not come up; last log lines:"
  tail -n 30 "$RUN_DIR/$name.log"
  return 1
}

fulfiller_enabled() { [[ -f $FULFILLER_DIR/.env && -d $FULFILLER_DIR/node_modules ]]; }

show_status() {
  local name port
  for entry in "backend:$BACKEND_PORT" "web:$WEB_PORT" "fulfiller:$FULFILLER_PORT"; do
    name=${entry%%:*} port=${entry##*:}
    if [[ -n $(listening_pids "$port") ]]; then
      echo "$name  running on :$port"
    else
      echo "$name  stopped"
    fi
  done
}

finish() {
  local status=$1 message=$2
  rm -rf "$RUN_DIR/lock"
  [[ $HOOK == 1 ]] || { [[ $status == 0 ]] && log "$message"; exit "$status"; }
  if [[ $status == 0 ]]; then
    printf '{"systemMessage":"%s"}\n' "$message" >&3
    exit 0
  fi
  # Block once so Claude sees the failure and can fix it; never block twice in a row.
  if [[ $STOP_HOOK_ACTIVE == 1 ]]; then
    printf '{"systemMessage":"%s (see logs/dev/restart.log)"}\n' "$message" >&3
    exit 0
  fi
  { echo "$message. Output of this restart:"; tail -n "+$LOG_START" "$RUN_DIR/restart.log" | tail -n 40; } >&4
  exit 2
}

case "$MODE" in
  status) show_status; exit 0 ;;
  stop)
    stop_service web "$WEB_PORT"
    stop_service fulfiller "$FULFILLER_PORT"
    stop_service backend "$BACKEND_PORT"
    exit 0
    ;;
esac

if ! mkdir "$RUN_DIR/lock" 2>/dev/null; then
  log "another restart is running (remove logs/dev/lock if it is stale)"
  [[ $HOOK == 1 ]] && exit 0
  exit 1
fi

if [[ $HOOK == 1 && $(fingerprint) == "$(cat "$RUN_DIR/fingerprint" 2>/dev/null)" ]]; then
  log "no code changes since the last restart; skipping"
  rm -rf "$RUN_DIR/lock"
  exit 0
fi

# 1. Database
if [[ $(docker inspect -f '{{.State.Running}}' ez-ai-dev-pg 2>/dev/null) != true ]]; then
  log "starting PostgreSQL"
  docker compose -f docker-compose.dev.yml up -d postgres || finish 1 "PostgreSQL did not start"
fi

# 2. Frontend dependencies, and web/dist which the backend embeds
if [[ ! -d web/node_modules ]]; then
  log "installing frontend dependencies"
  (cd web && bun install) || finish 1 "bun install failed"
fi
if [[ ! -f web/dist/index.html ]]; then
  log "building web/dist for the backend embed"
  (cd web && bun run build) || finish 1 "frontend build failed"
fi

# 3. Build before stopping anything, so a broken build leaves the old backend running
log "building backend"
go build -o ez-ai.next . || { rm -f ez-ai.next; finish 1 "Backend build failed; old services left running"; }

# 4. Restart
stop_service web "$WEB_PORT" || finish 1 "Port $WEB_PORT is taken by another program"
stop_service fulfiller "$FULFILLER_PORT" || finish 1 "Port $FULFILLER_PORT is taken by another program"
stop_service backend "$BACKEND_PORT" || finish 1 "Port $BACKEND_PORT is taken by another program"
mv -f ez-ai.next ez-ai

start_service backend "$ROOT" ./ez-ai --log-dir ./logs
start_service web "$ROOT/web" bun run dev -- --port "$WEB_PORT"
if fulfiller_enabled; then
  start_service fulfiller "$FULFILLER_DIR" node src/server.mjs
else
  log "fulfiller skipped (needs services/dogpay-fulfiller/.env and node_modules)"
fi

failed=()
wait_http backend "http://127.0.0.1:$BACKEND_PORT/api/status" 60 || failed+=(backend)
wait_http web "http://127.0.0.1:$WEB_PORT/" 120 || failed+=(frontend)
if fulfiller_enabled; then
  wait_http fulfiller "http://127.0.0.1:$FULFILLER_PORT/v1/ping" 30 || failed+=(fulfiller)
fi
[[ ${#failed[@]} == 0 ]] || finish 1 "Did not start: ${failed[*]}"

# Taken after startup so files the dev server regenerates do not trigger another restart.
fingerprint >"$RUN_DIR/fingerprint"
finish 0 "Dev services restarted: backend :$BACKEND_PORT, frontend :$WEB_PORT$(fulfiller_enabled && echo ", fulfiller :$FULFILLER_PORT")"
