#!/usr/bin/env bash
# Kyosei Insight -- operator console
#
# Interactive whiptail menu in the style of Proxmox VE Helper-Scripts.
# Direct subcommands also work for scripting and cron.
#
# `sudo update`                = open menu
# `sudo update <subcommand>`   = run directly (see `update help`)

set -uo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/kyosei-insight}"
BACKUP_DIR_DEFAULT="${BACKUP_DIR:-/var/backups/kyosei}"

# --- Branding ----------------------------------------------------------------
APP_NAME="Kyosei Insight"
APP_TAG="self-hosted log analytics"

# --- Colors (ANSI for command output; whiptail handles its own theming) ------
if [[ -t 1 ]]; then
  C_RESET=$'\e[0m'; C_BOLD=$'\e[1m'; C_DIM=$'\e[2m'
  C_CYAN=$'\e[1;36m'; C_GREEN=$'\e[1;32m'; C_YELLOW=$'\e[1;33m'
  C_RED=$'\e[1;31m'; C_BLUE=$'\e[1;34m'; C_MAGENTA=$'\e[1;35m'
else
  C_RESET=''; C_BOLD=''; C_DIM=''
  C_CYAN=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_BLUE=''; C_MAGENTA=''
fi

log()  { printf "%s[+]%s %s\n" "$C_CYAN" "$C_RESET" "$*"; }
warn() { printf "%s[!]%s %s\n" "$C_YELLOW" "$C_RESET" "$*"; }
err()  { printf "%s[x]%s %s\n" "$C_RED" "$C_RESET" "$*" >&2; }
ok()   { printf "%s[OK]%s %s\n" "$C_GREEN" "$C_RESET" "$*"; }
hdr()  { printf "\n%s── %s ──%s\n" "$C_BOLD" "$*" "$C_RESET"; }
die()  { err "$*"; exit 1; }

require_root() { [[ "$(id -u)" -eq 0 ]] || die "Run as root (try: sudo update)"; }
require_dir()  { [[ -d "$INSTALL_DIR" ]] || die "Install dir not found: $INSTALL_DIR"; cd "$INSTALL_DIR"; }

# --- Whiptail theming (tteck-inspired) ---------------------------------------
# Blue background, white foreground, cyan title -- matches Proxmox helper feel.
export NEWT_COLORS='
root=,blue
window=,black
border=white,black
title=cyan,black
textbox=white,black
button=black,white
compactbutton=white,black
listbox=white,black
actlistbox=black,white
actsellistbox=black,white
checkbox=white,black
actcheckbox=black,white
entry=white,black
disentry=lightgray,black
label=white,black
'

WT_BACKTITLE="$APP_NAME -- Operator Console"
WT_H=24
WT_W=78
WT_MENU_H=14

have_whiptail() { command -v whiptail >/dev/null 2>&1; }

# Banner shown when entering the menu -- tteck/community-scripts style.
print_banner() {
  clear
  cat <<'EOF'

      _  __                     _   ___           _      _     _
     | |/ /   _  ___  ___  ___ (_) |_ _|_ __  ___(_) ___| |__ | |_
     | ' / | | |/ _ \/ __|/ _ \| |  | || '_ \/ __| |/ _ \ '_ \| __|
     | . \ |_| | (_) \__ \  __/| |  | || | | \__ \ |  __/ | | | |_
     |_|\_\__, |\___/|___/\___||_| |___|_| |_|___/_|\___|_| |_|\__|
          |___/
EOF
  printf "       %s%s%s\n\n" "$C_DIM" "$APP_TAG" "$C_RESET"
}

# Render a one-line status footer for the menu title bar.
stack_summary() {
  local running total ver commit
  running=$(docker compose ps --status running -q 2>/dev/null | wc -l)
  total=$(docker compose config --services 2>/dev/null | wc -l)
  ver="?"; commit="?"
  [[ -f api/package.json ]] && ver=$(grep -E '"version"' api/package.json | head -1 | sed -E 's/.*"version":\s*"([^"]+)".*/\1/' || echo "?")
  [[ -d .git ]] && commit=$(git rev-parse --short HEAD 2>/dev/null || echo "?")
  printf "v%s @ %s | %d/%d services up" "$ver" "$commit" "$running" "$total"
}

pause() {
  echo
  printf "%s" "${C_DIM}Press Enter to return to the menu...${C_RESET}"
  read -r _ < /dev/tty || true
}

# Confirmation prompt (whiptail or plain).
ask_yesno() {
  local question="$1"
  if have_whiptail; then
    whiptail --backtitle "$WT_BACKTITLE" --title "Confirm" \
             --yesno "$question" 10 70
    return $?
  else
    printf "%s [y/N] " "$question"
    read -r answer < /dev/tty
    [[ "$answer" =~ ^[Yy]$ ]]
  fi
}

# --- Subcommands -------------------------------------------------------------

cmd_apply() {
  local do_pull=1 do_hard=0
  for arg in "$@"; do
    case "$arg" in
      --no-pull) do_pull=0 ;;
      --hard)    do_hard=1 ;;
      *) warn "Unknown apply arg: $arg" ;;
    esac
  done

  if [[ "$do_pull" -eq 1 ]]; then
    hdr "Syncing from git"
    if [[ ! -d .git ]]; then
      warn "Not a git checkout -- skipping git sync."
    else
      # This is a DEPLOY TARGET, not a dev box. GitHub is the single source of
      # truth — force-match it instead of merging. This permanently kills the
      # recurring "local changes would be overwritten" / corrupted-update.sh
      # loop: any on-box drift (chmod, half-edits, a clobbered update.sh)
      # self-heals every run instead of compounding. .env, data/, and
      # docker-compose.override.yml are gitignored, so they are never touched.
      local old new branch
      branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)
      [[ "$branch" == "HEAD" || -z "$branch" ]] && branch=main
      old=$(git rev-parse HEAD 2>/dev/null || echo "")
      if ! git fetch --quiet origin "$branch"; then
        err "git fetch failed -- check network / SSH deploy key"
        return 1
      fi
      git reset --hard "origin/$branch" >/dev/null 2>&1 || { err "git reset failed"; return 1; }
      chmod +x "$INSTALL_DIR"/deploy/*.sh 2>/dev/null || true
      new=$(git rev-parse HEAD 2>/dev/null || echo "")
      if [[ "$old" == "$new" ]]; then
        log "Already up to date -- no code changes."
      else
        log "Synced $(git rev-parse --short "$old") -> $(git rev-parse --short "$new")"
        echo
        printf "%sChanged files:%s\n" "$C_BOLD" "$C_RESET"
        git diff --stat "$old..$new" | sed 's/^/  /'
        echo
      fi
    fi
  else
    warn "Skipping git sync (--no-pull)"
  fi

  local build_pull="--pull=false"
  if [[ "$do_hard" -eq 1 ]]; then
    hdr "Pulling base images (CVE refresh)"
    docker compose pull
    # --hard means "also patch CVEs in the container base images": rebuild
    # FROM the newest base layers instead of cached ones.
    build_pull="--pull"
  fi

  hdr "Building containers"
  # Force plain progress so output shows every step line-by-line, even when
  # stdout isn't a TTY (e.g. when invoked via the /usr/local/bin/update wrapper
  # or piped to a log). Without this BuildKit goes silent in non-TTY contexts.
  DOCKER_BUILDKIT=1 docker compose build "$build_pull" --progress=plain

  hdr "Restarting stack"
  docker compose up -d --remove-orphans

  # Apply schema. db/init/*.sql only auto-loads on a FRESH ClickHouse volume,
  # so new tables/MVs added in an update would otherwise silently never exist
  # on an existing install (this is exactly what broke DHCP). Every file uses
  # CREATE ... IF NOT EXISTS, so re-applying on every update is safe + cheap.
  hdr "Applying schema (idempotent)"
  local pw
  pw=$(grep -E '^CLICKHOUSE_PASSWORD=' "$INSTALL_DIR/.env" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)
  if [[ -n "$pw" ]]; then
    local ok_ch=0 j
    for j in $(seq 1 30); do
      if docker exec ki-clickhouse clickhouse-client --user kyosei --password "$pw" \
           --query "SELECT 1" >/dev/null 2>&1; then ok_ch=1; break; fi
      sleep 2
    done
    if [[ "$ok_ch" -eq 1 ]]; then
      local f
      for f in "$INSTALL_DIR"/db/init/*.sql; do
        [[ -e "$f" ]] || continue
        if docker exec -i ki-clickhouse clickhouse-client --user kyosei --password "$pw" \
             --multiquery < "$f" >/dev/null 2>&1; then
          log "  applied $(basename "$f")"
        else
          warn "  $(basename "$f") had errors (often harmless: existing objects)"
        fi
      done
    else
      warn "ClickHouse not reachable -- skipped schema apply (re-run 'update apply')"
    fi
  else
    warn "No CLICKHOUSE_PASSWORD in .env -- skipped schema apply"
  fi

  # Web category feeds: keep the weekly cron in place, and seed the map in
  # the background on first run (don't block apply on feed downloads).
  if [[ -f "$INSTALL_DIR/deploy/refresh-categories.sh" ]]; then
    chmod +x "$INSTALL_DIR/deploy/refresh-categories.sh" 2>/dev/null || true
    ensure_category_cron
    if [[ ! -f "$INSTALL_DIR/data/domain_categories.tsv" ]]; then
      log "Seeding web category map in background (first run; ~1-2 min)..."
      nohup env INSTALL_DIR="$INSTALL_DIR" "$INSTALL_DIR/deploy/refresh-categories.sh" --quiet \
        >> /var/log/kyosei-categories.log 2>&1 &
    fi
  fi

  log "Waiting for API to respond (up to 60s)..."
  local i
  for i in {1..60}; do
    # Any HTTP response = API is up. 401/403 still means it's accepting requests.
    if curl -sS --max-time 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/health 2>/dev/null | grep -qE '^[2345][0-9][0-9]$'; then
      ok "API healthy after ${i}s"; break
    fi
    printf "."
    sleep 1
    [[ "$i" -eq 60 ]] && { echo; warn "API didn't respond in 60s -- check: update logs api"; }
  done
  echo

  cmd_status

  local dangling
  dangling=$(docker images -f "dangling=true" -q | wc -l)
  if [[ "$dangling" -gt 0 ]]; then
    log "Removing $dangling dangling image(s)..."
    docker image prune -f >/dev/null
  fi
  ok "Update complete."
}

ensure_category_cron() {
  local cf=/etc/cron.d/kyosei-categories
  cat > "$cf" <<EOF
# Kyosei Insight -- weekly web category feed refresh (managed by update.sh)
SHELL=/bin/bash
17 4 * * 0 root INSTALL_DIR=$INSTALL_DIR $INSTALL_DIR/deploy/refresh-categories.sh --quiet >> /var/log/kyosei-categories.log 2>&1
EOF
  chmod 644 "$cf"
}

cmd_refresh_categories() {
  hdr "Refreshing web category feeds"
  local script="$INSTALL_DIR/deploy/refresh-categories.sh"
  [[ -f "$script" ]] || { err "Not found: $script (run 'update apply' first)"; return 1; }
  chmod +x "$script" 2>/dev/null || true
  if INSTALL_DIR="$INSTALL_DIR" "$script"; then
    ok "Category map rebuilt (ingestor hot-reloads within ~60s)."
  else
    warn "Refresh reported a problem -- kept the existing map."
  fi
  ensure_category_cron
  log "Weekly auto-refresh cron: /etc/cron.d/kyosei-categories (Sundays 04:17)"
}

cmd_status() {
  hdr "Stack status"
  docker compose ps --format 'table {{.Service}}\t{{.Status}}\t{{.Ports}}'
  if [[ -f api/package.json ]]; then
    local ver
    ver=$(grep -E '"version"' api/package.json | head -1 | sed -E 's/.*"version":\s*"([^"]+)".*/\1/' || true)
    [[ -n "$ver" ]] && echo "  Running version: $ver"
  fi
  if [[ -d .git ]]; then
    echo "  Commit: $(git rev-parse --short HEAD 2>/dev/null) ($(git log -1 --format=%ad --date=short 2>/dev/null))"
  fi
}

# Pick a service via whiptail radiolist, or prompt if no whiptail.
pick_service() {
  local prompt="$1" include_all="${2:-1}"
  local services
  mapfile -t services < <(docker compose config --services 2>/dev/null)
  [[ "${#services[@]}" -eq 0 ]] && { err "No services found"; return 1; }

  if have_whiptail; then
    local items=() svc
    [[ "$include_all" -eq 1 ]] && items+=("all" "All services")
    for svc in "${services[@]}"; do items+=("$svc" ""); done
    whiptail --backtitle "$WT_BACKTITLE" --title "Select service" \
             --menu "$prompt" $WT_H $WT_W $WT_MENU_H "${items[@]}" 3>&1 1>&2 2>&3
  else
    echo "$prompt"
    local i=1 svc
    [[ "$include_all" -eq 1 ]] && { echo "  0) all"; }
    for svc in "${services[@]}"; do printf "  %d) %s\n" "$i" "$svc"; i=$((i+1)); done
    printf "Pick: "; read -r choice < /dev/tty
    if [[ "$choice" == "0" ]]; then echo "all"
    elif [[ "$choice" =~ ^[0-9]+$ ]]; then echo "${services[$((choice-1))]}"
    else echo "$choice"; fi
  fi
}

cmd_logs() {
  local svc="${1:-}"
  [[ -z "$svc" ]] && svc=$(pick_service "Tail logs for which service?")
  [[ -z "$svc" ]] && { warn "Cancelled"; return 0; }
  clear
  hdr "Logs: $svc  (Ctrl-C to return)"
  if [[ "$svc" == "all" ]]; then
    docker compose logs -f --tail=50
  else
    docker compose logs -f --tail=100 "$svc"
  fi
}

cmd_restart() {
  local svc="${1:-}"
  [[ -z "$svc" ]] && svc=$(pick_service "Restart which service?")
  [[ -z "$svc" ]] && { warn "Cancelled"; return 0; }
  if [[ "$svc" == "all" ]]; then
    hdr "Restarting entire stack"
    docker compose restart
  else
    hdr "Restarting $svc"
    docker compose restart "$svc"
  fi
  cmd_status
}

cmd_os() {
  hdr "OS package update (LXC)"
  echo "Patches the container's Debian packages — kernel-userspace libs,"
  echo "openssl, etc. Run this regularly, or enable auto-patching below."
  echo
  ask_yesno "Run 'apt update && apt full-upgrade' now?" || { warn "Cancelled."; return 0; }

  export DEBIAN_FRONTEND=noninteractive
  hdr "apt update"
  apt-get update
  hdr "apt full-upgrade"
  apt-get -y full-upgrade
  hdr "apt autoremove"
  apt-get -y autoremove --purge
  apt-get -y clean

  if [[ -f /var/run/reboot-required ]]; then
    warn "A reboot is required to finish applying updates (kernel/libc)."
    warn "On an LXC this usually means: pct reboot <ctid> from the Proxmox host."
  else
    ok "OS packages up to date. No reboot required."
  fi

  echo
  if ! dpkg -s unattended-upgrades >/dev/null 2>&1; then
    if ask_yesno "Enable automatic security patching (unattended-upgrades)?
Recommended for an internet-exposed security appliance."; then
      apt-get install -y unattended-upgrades
      dpkg-reconfigure -f noninteractive -p low unattended-upgrades 2>/dev/null || true
      systemctl enable --now unattended-upgrades 2>/dev/null || true
      ok "unattended-upgrades enabled — security patches apply automatically."
    fi
  else
    ok "unattended-upgrades already installed (auto security patching on)."
  fi
}

cmd_prune() {
  hdr "Docker prune"
  echo "This will remove:"
  echo "  • Stopped containers"
  echo "  • Dangling images (untagged)"
  echo "  • Unused build cache"
  echo "  • Unused networks"
  echo "Volumes are NOT touched -- your ClickHouse data is safe."
  echo
  ask_yesno "Proceed with Docker prune?" || { warn "Cancelled."; return 0; }

  hdr "Before"; docker system df
  echo
  log "Pruning stopped containers..."; docker container prune -f
  log "Pruning dangling images...";    docker image prune -f
  log "Pruning unused build cache..."; docker builder prune -f
  log "Pruning unused networks...";    docker network prune -f
  hdr "After"; docker system df
  ok "Prune complete."
}

cmd_disk() {
  hdr "Host disk"
  df -h / /var/lib/docker 2>/dev/null | column -t

  hdr "Docker disk usage"
  docker system df

  hdr "Largest Docker volumes"
  for vol in $(docker volume ls -q); do
    local path size
    path=$(docker volume inspect "$vol" --format '{{.Mountpoint}}' 2>/dev/null)
    if [[ -d "$path" ]]; then
      size=$(du -sh "$path" 2>/dev/null | awk '{print $1}')
      printf "  %-40s %s\n" "$vol" "$size"
    fi
  done | sort -k2 -h -r | head -10

  hdr "ClickHouse tables (top by disk)"
  local pw
  pw=$(grep -E '^CLICKHOUSE_PASSWORD=' "$INSTALL_DIR/.env" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)
  if [[ -z "$pw" ]]; then
    warn "Can't read CLICKHOUSE_PASSWORD from .env"
  else
    docker exec ki-clickhouse clickhouse-client --user kyosei --password "$pw" \
      --query "SELECT table,
                      formatReadableSize(sum(bytes_on_disk)) AS disk,
                      formatReadableSize(sum(data_uncompressed_bytes)) AS raw,
                      round(sum(data_uncompressed_bytes) / sum(bytes_on_disk), 1) AS ratio,
                      sum(rows) AS rows
               FROM system.parts WHERE active AND database='kyosei'
               GROUP BY table ORDER BY sum(bytes_on_disk) DESC FORMAT PrettyCompact" \
      2>/dev/null || warn "ClickHouse query failed -- is the container up?"
  fi

  hdr "Disk runway (forecast)"
  # Compute the forecast straight from ClickHouse (same logic as the
  # /api/system/forecast endpoint) so this works without an API session.
  # The API route is auth-gated on purpose; the operator console already has
  # the CH password, so query directly and let CH format the sizes.
  if [[ -n "$pw" ]]; then
    docker exec ki-clickhouse clickhouse-client --user kyosei --password "$pw" \
      --query "
        WITH
          (SELECT count() FROM kyosei.raw_logs
             WHERE received_at >= now() - INTERVAL 7 DAY) AS rows_in_window,
          (SELECT min(received_at) FROM kyosei.raw_logs
             WHERE received_at >= now() - INTERVAL 7 DAY) AS window_start,
          greatest(1.0/24.0,
            least(7.0, dateDiff('second', window_start, now()) / 86400.0)
          ) AS days_observed,
          (SELECT sum(rows) FROM system.parts
             WHERE database='kyosei' AND table='raw_logs' AND active) AS raw_rows,
          (SELECT sum(bytes_on_disk) FROM system.parts
             WHERE database='kyosei' AND active) AS total_bytes,
          if(raw_rows > 0, total_bytes / raw_rows, 0) AS bytes_per_event,
          bytes_per_event * (rows_in_window / days_observed) AS bpd
        SELECT
          formatReadableSize(bpd)         AS per_day,
          toUInt64(rows_in_window / days_observed) AS rows_per_day,
          formatReadableSize(bpd * 30)    AS \"30_days\",
          formatReadableSize(bpd * 90)    AS \"90_days\",
          formatReadableSize(bpd * 365)   AS \"1_year\"
        FORMAT PrettyCompact" \
      2>/dev/null || warn "Forecast query failed -- is ClickHouse up?"
  else
    warn "Can't read CLICKHOUSE_PASSWORD from .env -- skipping forecast"
  fi
}

cmd_health() {
  hdr "Service ports"
  for p in 8080 3001 8123 514; do
    local proto="tcp"
    [[ "$p" == "514" ]] && proto="udp"
    if ss -lnu 2>/dev/null | grep -q ":$p\b" || ss -lnt 2>/dev/null | grep -q ":$p\b"; then
      ok "port $p/$proto listening"
    else
      err "port $p/$proto NOT listening"
    fi
  done

  hdr "API /api/health"
  if curl -fsS --max-time 3 http://127.0.0.1:3001/api/health; then
    echo; ok "API responded"
  else
    err "API did not respond"
  fi

  hdr "ClickHouse ping"
  if docker exec ki-clickhouse wget -q -O- --timeout=3 http://localhost:8123/ping 2>/dev/null | grep -q "Ok"; then
    ok "ClickHouse healthy"
  else
    err "ClickHouse did not respond"
  fi

  hdr "Events received in last 5 minutes"
  local pw
  pw=$(grep -E '^CLICKHOUSE_PASSWORD=' "$INSTALL_DIR/.env" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)
  if [[ -n "$pw" ]]; then
    docker exec ki-clickhouse clickhouse-client --user kyosei --password "$pw" \
      --query "SELECT source_kind,
                      count() AS events_5m,
                      max(received_at) AS last_seen
               FROM kyosei.raw_logs
               WHERE received_at > now() - INTERVAL 5 MINUTE
               GROUP BY source_kind FORMAT PrettyCompact" 2>/dev/null \
      || warn "Could not query raw_logs"
  fi
}

cmd_backup() {
  local dest="${1:-$BACKUP_DIR_DEFAULT}"
  mkdir -p "$dest"
  local ts out
  ts=$(date +%Y%m%d-%H%M%S)
  out="$dest/kyosei-backup-$ts.tar.gz"

  hdr "Backing up control plane -> $out"
  log "Including: api/data/ (SQLite + GeoIP), .env, db/init/"
  warn "ClickHouse data NOT included (too large; rely on TTL + re-ingest)."

  tar -czf "$out" -C "$INSTALL_DIR" api/data .env db/init 2>&1 | sed 's/^/  /'

  if [[ -f "$out" ]]; then
    local sz; sz=$(du -h "$out" | awk '{print $1}')
    ok "Backup written: $out ($sz)"
  else
    err "Backup failed"; return 1
  fi
}

cmd_config() {
  hdr "Effective config (.env, secrets masked)"
  [[ -f .env ]] || { err "No .env in $INSTALL_DIR"; return 1; }
  awk -F= '
    /^[[:space:]]*#/ { print; next }
    /^[[:space:]]*$/ { print; next }
    /PASSWORD|SECRET|KEY|TOKEN/ {
      n=$1; $1=""; sub(/^=/,"",$0)
      if (length($0) > 0) printf "%s=********\n", n; else print
      next
    }
    { print }
  ' .env
}

cmd_shell() {
  local svc="${1:-}"
  [[ -z "$svc" ]] && svc=$(pick_service "Open shell in which service?" 0)
  [[ -z "$svc" ]] && { warn "Cancelled"; return 0; }
  clear
  hdr "Opening shell in $svc"
  if docker compose exec "$svc" sh -c 'command -v bash' >/dev/null 2>&1; then
    docker compose exec "$svc" bash
  else
    docker compose exec "$svc" sh
  fi
}

cmd_help() {
  cat <<EOF
${C_BOLD}$APP_NAME -- operator console${C_RESET}

  ${C_CYAN}update${C_RESET}                       interactive whiptail menu
  ${C_CYAN}update apply${C_RESET} [--hard]        pull, rebuild, restart (--hard also patches base-image CVEs)
  ${C_CYAN}update os${C_RESET}                    apt update/upgrade the LXC + offer auto-patching
  ${C_CYAN}update refresh-categories${C_RESET}    rebuild the web domain->category map now + (re)install weekly cron
  ${C_CYAN}update status${C_RESET}                docker compose ps
  ${C_CYAN}update logs${C_RESET} [service]        tail logs (picker if omitted)
  ${C_CYAN}update restart${C_RESET} [service|all] restart a service
  ${C_CYAN}update prune${C_RESET}                 clean Docker (keeps volumes)
  ${C_CYAN}update disk${C_RESET}                  disk usage + CH tables + forecast
  ${C_CYAN}update health${C_RESET}                ports + API + CH + recent events
  ${C_CYAN}update backup${C_RESET} [path]         tar of SQLite + .env + schemas
  ${C_CYAN}update config${C_RESET}                show .env (secrets masked)
  ${C_CYAN}update shell${C_RESET} [service]       shell into a container
  ${C_CYAN}update help${C_RESET}                  this help

${C_DIM}Old flags still work:${C_RESET}
  ${C_DIM}update --hard${C_RESET}    = update apply --hard
  ${C_DIM}update --no-pull${C_RESET} = update apply --no-pull
EOF
}

# --- Interactive menu (whiptail) ---------------------------------------------

menu_main_whiptail() {
  while true; do
    local title
    title="$APP_NAME  |  $(stack_summary)"

    local choice rc
    # Capture both the chosen value and whiptail's exit code so we can tell
    # "user cancelled" from "user picked Quit". Doing this in one step avoids
    # `set -u` / `$?` ordering footguns.
    choice=$(whiptail --backtitle "$WT_BACKTITLE" \
                      --title "$title" \
                      --menu "Choose an action:" \
                      $WT_H $WT_W $WT_MENU_H \
                      "1"  "Apply update         (pull + rebuild + restart)" \
                      "2"  "Hard update          (also patch base-image CVEs)" \
                      "13" "OS update            (apt upgrade the LXC + auto-patch)" \
                      "14" "Refresh web cats     (rebuild domain->category map)" \
                      "3"  "Service status       (docker compose ps)" \
                      "4"  "Tail logs            (pick a service)" \
                      "5"  "Restart a service" \
                      "6"  "Shell into container" \
                      "7"  "Health check         (ports / API / CH / events)" \
                      "8"  "Disk & storage       (df / CH tables / forecast)" \
                      "9"  "Prune Docker         (frees space - keeps data)" \
                      "10" "Backup control plane (SQLite + .env to tar.gz)" \
                      "11" "Show .env            (secrets masked)" \
                      "12" "Web UI URL hint" \
                      "Q"  "Quit" \
                      3>&1 1>&2 2>&3)
    rc=$?

    # rc != 0 = user hit Cancel or Esc
    if [[ "$rc" -ne 0 ]]; then
      clear; echo "Bye."; exit 0
    fi

    clear; print_banner
    case "$choice" in
      1)  cmd_apply;          pause ;;
      2)  cmd_apply --hard;   pause ;;
      13) cmd_os;             pause ;;
      14) cmd_refresh_categories; pause ;;
      3)  cmd_status;         pause ;;
      4)  cmd_logs ;;
      5)  cmd_restart;        pause ;;
      6)  cmd_shell ;;
      7)  cmd_health;         pause ;;
      8)  cmd_disk;           pause ;;
      9)  cmd_prune;          pause ;;
      10) cmd_backup;         pause ;;
      11) cmd_config;         pause ;;
      12)
          local ip; ip=$(hostname -I | awk '{print $1}')
          whiptail --backtitle "$WT_BACKTITLE" --title "Web UI" \
                   --msgbox "Local URL: http://$ip:8080\n\nOr your reverse-proxy hostname if you have one configured (e.g. https://kyosei.example.com)." \
                   10 70
          ;;
      Q|q) clear; echo "Bye."; exit 0 ;;
      *) warn "Unknown choice: $choice"; sleep 1 ;;
    esac
  done
}

# --- Fallback menu (no whiptail) ---------------------------------------------

menu_main_plain() {
  while true; do
    print_banner
    cat <<EOF
  ${C_DIM}$(stack_summary)${C_RESET}

  ${C_BOLD}Updates${C_RESET}
   ${C_CYAN}1${C_RESET}) Apply update            (pull + rebuild + restart)
   ${C_CYAN}2${C_RESET}) Hard update             (also patch base-image CVEs)
  ${C_CYAN}13${C_RESET}) OS update               (apt upgrade the LXC + auto-patch)

  ${C_BOLD}Service control${C_RESET}
   ${C_CYAN}3${C_RESET}) Status
   ${C_CYAN}4${C_RESET}) Tail logs
   ${C_CYAN}5${C_RESET}) Restart a service
   ${C_CYAN}6${C_RESET}) Shell into a container

  ${C_BOLD}Maintenance${C_RESET}
   ${C_CYAN}7${C_RESET}) Health check
   ${C_CYAN}8${C_RESET}) Disk & storage
   ${C_CYAN}9${C_RESET}) Prune Docker
  ${C_CYAN}10${C_RESET}) Backup control plane
  ${C_CYAN}14${C_RESET}) Refresh web categories  (rebuild domain map)

  ${C_BOLD}Config${C_RESET}
  ${C_CYAN}11${C_RESET}) Show .env               (secrets masked)
  ${C_CYAN}12${C_RESET}) Web UI URL hint

  ${C_CYAN} 0${C_RESET}) Quit

EOF
    printf "  Choose: "
    read -r choice < /dev/tty
    echo
    case "$choice" in
      1)  cmd_apply;          pause ;;
      2)  cmd_apply --hard;   pause ;;
      13) cmd_os;             pause ;;
      14) cmd_refresh_categories; pause ;;
      3)  cmd_status;         pause ;;
      4)  cmd_logs ;;
      5)  cmd_restart;        pause ;;
      6)  cmd_shell ;;
      7)  cmd_health;         pause ;;
      8)  cmd_disk;           pause ;;
      9)  cmd_prune;          pause ;;
      10) cmd_backup;         pause ;;
      11) cmd_config;         pause ;;
      12)
          local ip; ip=$(hostname -I | awk '{print $1}')
          echo "  Web UI: http://$ip:8080"
          echo "  (or your reverse proxy hostname if configured)"
          pause
          ;;
      0|q|Q) clear; echo "Bye."; exit 0 ;;
      *) warn "Unknown choice: $choice"; sleep 1 ;;
    esac
  done
}

menu_main() {
  if have_whiptail; then
    menu_main_whiptail
  else
    warn "whiptail not installed -- falling back to plain menu."
    warn "Install with: apt-get install -y whiptail"
    sleep 2
    menu_main_plain
  fi
}

# --- Dispatcher --------------------------------------------------------------

main() {
  require_root
  require_dir

  if [[ $# -eq 0 ]]; then
    menu_main
    return
  fi

  case "$1" in
    apply)    shift; cmd_apply "$@" ;;
    os)       cmd_os ;;
    refresh-categories|refresh-cats) cmd_refresh_categories ;;
    status)   cmd_status ;;
    logs)     shift; cmd_logs "${1:-}" ;;
    restart)  shift; cmd_restart "${1:-}" ;;
    prune)    cmd_prune ;;
    disk)     cmd_disk ;;
    health)   cmd_health ;;
    backup)   shift; cmd_backup "${1:-}" ;;
    config)   cmd_config ;;
    shell)    shift; cmd_shell "${1:-}" ;;
    help|-h|--help) cmd_help ;;
    --hard|--no-pull) cmd_apply "$@" ;;
    *) err "Unknown subcommand: $1"; echo; cmd_help; exit 1 ;;
  esac
}

main "$@"
