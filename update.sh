#!/usr/bin/env bash
# Kyosei Dash -- operator console
#
# Interactive whiptail menu in the style of Proxmox VE Helper-Scripts.
# Direct subcommands also work for scripting and cron.
#
# `sudo update`                = open menu
# `sudo update <subcommand>`   = run directly (see `update help`)

set -uo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/kyosei-dash}"
BACKUP_DIR_DEFAULT="${BACKUP_DIR:-/var/backups/kyosei}"
APP_PORT="${APP_PORT:-3001}"

# --- Branding ----------------------------------------------------------------
APP_NAME="Kyosei Dash"
APP_TAG="symbiosis for monitoring -- Uptime Kuma engine + PRTG data"

# --- Colors ------------------------------------------------------------------
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
WT_H=22
WT_W=78
WT_MENU_H=12

have_whiptail() { command -v whiptail >/dev/null 2>&1; }

print_banner() {
  clear
  cat <<'EOF'

      _  __                     _   ____            _
     | |/ /   _  ___  ___  ___ (_) |  _ \  __ _ ___| |__
     | ' / | | |/ _ \/ __|/ _ \| | | | | |/ _` / __| '_ \
     | . \ |_| | (_) \__ \  __/| | | |_| | (_| \__ \ | | |
     |_|\_\__, |\___/|___/\___||_| |____/ \__,_|___/_| |_|
          |___/   共生
EOF
  printf "       %s%s%s\n\n" "$C_DIM" "$APP_TAG" "$C_RESET"
}

stack_summary() {
  local running total ver commit
  running=$(docker compose ps --status running -q 2>/dev/null | wc -l)
  total=$(docker compose config --services 2>/dev/null | wc -l)
  ver="?"; commit="?"
  [[ -f package.json ]] && ver=$(grep -E '"version"' package.json | head -1 | sed -E 's/.*"version":\s*"([^"]+)".*/\1/' || echo "?")
  [[ -d .git ]] && commit=$(git rev-parse --short HEAD 2>/dev/null || echo "?")
  printf "v%s @ %s | %d/%d services up" "$ver" "$commit" "$running" "$total"
}

pause() {
  echo
  printf "%s" "${C_DIM}Press Enter to return to the menu...${C_RESET}"
  read -r _ < /dev/tty || true
}

ask_yesno() {
  local question="$1"
  if have_whiptail; then
    whiptail --backtitle "$WT_BACKTITLE" --title "Confirm" --yesno "$question" 10 70
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
      # SECURITY: this is a production deploy target. By default we only ever
      # deploy *tagged releases*, never raw `main`. That means an unreviewed
      # or malicious commit pushed to main does NOT auto-run here -- a human
      # has to deliberately `git tag vX.Y.Z` a reviewed commit. Set
      # KYOSEI_TRACK=main (or pass --main) to opt into bleeding-edge main.
      local old new target track
      track="${KYOSEI_TRACK:-tag}"
      for a in "$@"; do [[ "$a" == "--main" ]] && track="main"; done
      old=$(git rev-parse HEAD 2>/dev/null || echo "")
      if ! git fetch --quiet --tags --force origin; then
        err "git fetch failed -- check network / repo URL"
        return 1
      fi
      if [[ "$track" == "main" ]]; then
        warn "KYOSEI_TRACK=main -- deploying un-tagged HEAD of main (NOT recommended for production)"
        target="origin/main"
      else
        # Latest semver-ish tag (v1.2.3, v1.2.3-beta, ...), highest version wins
        target=$(git tag -l 'v*' --sort=-v:refname | head -1)
        if [[ -z "$target" ]]; then
          err "No version tags found in the repo."
          err "On your dev machine: git tag v1.0.0 && git push --tags"
          err "(Or run with --main to deploy untagged main, not recommended.)"
          return 1
        fi
        log "Latest release tag: $target"
      fi
      git reset --hard "$target" >/dev/null 2>&1 || { err "git reset to $target failed"; return 1; }
      chmod +x "$INSTALL_DIR"/deploy/*.sh "$INSTALL_DIR"/update.sh 2>/dev/null || true
      new=$(git rev-parse HEAD 2>/dev/null || echo "")
      if [[ "$old" == "$new" ]]; then
        log "Already on $target -- no code changes."
      else
        log "Deployed $target ($(git rev-parse --short "$old") -> $(git rev-parse --short "$new"))"
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
    hdr "Pulling base image (CVE refresh)"
    docker compose pull 2>/dev/null || true
    build_pull="--pull"
  fi

  hdr "Building container"
  # Force plain progress so every build step shows even in non-TTY contexts.
  DOCKER_BUILDKIT=1 docker compose build "$build_pull" --progress=plain

  hdr "Restarting stack"
  docker compose up -d --remove-orphans

  # Kuma runs knex migrations automatically on boot -- no manual schema step.
  log "Waiting for Kyosei Dash to respond (up to 90s; first build runs migrations)..."
  local i
  for i in $(seq 1 90); do
    if curl -sS --max-time 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${APP_PORT}/" 2>/dev/null | grep -qE '^[2345][0-9][0-9]$'; then
      ok "Web UI healthy after ${i}s"; break
    fi
    printf "."
    sleep 1
    [[ "$i" -eq 90 ]] && { echo; warn "No response in 90s -- check: update logs"; }
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

cmd_status() {
  hdr "Stack status"
  docker compose ps --format 'table {{.Service}}\t{{.Status}}\t{{.Ports}}'
  if [[ -f package.json ]]; then
    local ver
    ver=$(grep -E '"version"' package.json | head -1 | sed -E 's/.*"version":\s*"([^"]+)".*/\1/' || true)
    [[ -n "$ver" ]] && echo "  Version: $ver"
  fi
  if [[ -d .git ]]; then
    echo "  Commit: $(git rev-parse --short HEAD 2>/dev/null) ($(git log -1 --format=%ad --date=short 2>/dev/null))"
  fi
}

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
    [[ "$include_all" -eq 1 ]] && echo "  0) all"
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
    hdr "Restarting entire stack"; docker compose restart
  else
    hdr "Restarting $svc"; docker compose restart "$svc"
  fi
  cmd_status
}

cmd_os() {
  hdr "OS package update (LXC)"
  echo "Patches the container's Debian packages -- libs, openssl, etc."
  echo
  ask_yesno "Run 'apt update && apt full-upgrade' now?" || { warn "Cancelled."; return 0; }
  export DEBIAN_FRONTEND=noninteractive
  hdr "apt update";        apt-get update
  hdr "apt full-upgrade";  apt-get -y full-upgrade
  hdr "apt autoremove";    apt-get -y autoremove --purge; apt-get -y clean
  if [[ -f /var/run/reboot-required ]]; then
    warn "A reboot is required (kernel/libc). On an LXC: pct reboot <ctid> from the Proxmox host."
  else
    ok "OS packages up to date. No reboot required."
  fi
  echo
  if ! dpkg -s unattended-upgrades >/dev/null 2>&1; then
    if ask_yesno "Enable automatic security patching (unattended-upgrades)?"; then
      apt-get install -y unattended-upgrades
      dpkg-reconfigure -f noninteractive -p low unattended-upgrades 2>/dev/null || true
      systemctl enable --now unattended-upgrades 2>/dev/null || true
      ok "unattended-upgrades enabled."
    fi
  else
    ok "unattended-upgrades already installed."
  fi
}

cmd_prune() {
  hdr "Docker prune"
  echo "Removes: stopped containers, dangling images, unused build cache + networks."
  echo "Volumes are NOT touched -- your Kyosei Dash data/ is safe."
  echo
  ask_yesno "Proceed with Docker prune?" || { warn "Cancelled."; return 0; }
  hdr "Before"; docker system df; echo
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
  hdr "Kyosei Dash data dir"
  if [[ -d "$INSTALL_DIR/data" ]]; then
    du -sh "$INSTALL_DIR/data" 2>/dev/null | awk '{print "  data/: " $1}'
    local db="$INSTALL_DIR/data/kuma.db"
    [[ -f "$db" ]] && du -h "$db" 2>/dev/null | awk '{print "  kuma.db: " $1}'
  else
    warn "No data/ dir at $INSTALL_DIR/data"
  fi
}

cmd_health() {
  hdr "Service port"
  if ss -lnt 2>/dev/null | grep -q ":${APP_PORT}\b"; then
    ok "port ${APP_PORT}/tcp listening"
  else
    err "port ${APP_PORT}/tcp NOT listening"
  fi
  hdr "Web UI"
  local code
  code=$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${APP_PORT}/" 2>/dev/null || echo "000")
  if [[ "$code" =~ ^[2345][0-9][0-9]$ ]]; then
    ok "HTTP $code from http://127.0.0.1:${APP_PORT}/"
  else
    err "No HTTP response (got '$code')"
  fi
  hdr "Container health"
  docker compose ps --format 'table {{.Service}}\t{{.Status}}'
  hdr "Recent errors (last 20 log lines matching error/warn)"
  docker compose logs --tail 200 2>&1 | grep -iE 'error|warn|exception' | tail -20 | sed 's/^/  /' || echo "  (none)"
}

cmd_backup() {
  local dest="${1:-$BACKUP_DIR_DEFAULT}"
  mkdir -p "$dest"
  local ts out
  ts=$(date +%Y%m%d-%H%M%S)
  out="$dest/kyosei-dash-backup-$ts.tar.gz"
  hdr "Backing up data/ -> $out"
  log "Includes: SQLite DB, uploads, PRTG server registry, all monitor config."
  if [[ ! -d "$INSTALL_DIR/data" ]]; then
    err "No data/ directory at $INSTALL_DIR/data"; return 1
  fi
  tar -czf "$out" -C "$INSTALL_DIR" data 2>&1 | sed 's/^/  /'
  if [[ -f "$out" ]]; then
    local sz; sz=$(du -h "$out" | awk '{print $1}')
    ok "Backup written: $out ($sz)"
    # Retain last 14 backups
    ls -1t "$dest"/kyosei-dash-backup-*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
  else
    err "Backup failed"; return 1
  fi
}

cmd_restore() {
  local src="${1:-}"
  if [[ -z "$src" ]]; then
    local latest
    latest=$(ls -1t "$BACKUP_DIR_DEFAULT"/kyosei-dash-backup-*.tar.gz 2>/dev/null | head -1)
    [[ -z "$latest" ]] && { err "No backups found in $BACKUP_DIR_DEFAULT"; return 1; }
    src="$latest"
  fi
  [[ -f "$src" ]] || { err "Backup not found: $src"; return 1; }
  hdr "Restore from $src"
  warn "This STOPS the stack, replaces data/, and restarts. Current data/ is overwritten."
  ask_yesno "Restore $src now?" || { warn "Cancelled."; return 0; }
  docker compose down
  rm -rf "$INSTALL_DIR/data"
  tar -xzf "$src" -C "$INSTALL_DIR"
  docker compose up -d --build
  ok "Restored. Give it ~30s, then check: update health"
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
  ${C_CYAN}update apply${C_RESET} [--hard] [--main] deploy latest tagged release, rebuild, restart
                               (--hard also patches base-image CVEs;
                                --main deploys untagged main -- NOT for production)
  ${C_CYAN}update os${C_RESET}                    apt update/upgrade the LXC + offer auto-patching
  ${C_CYAN}update status${C_RESET}                docker compose ps
  ${C_CYAN}update logs${C_RESET} [service]        tail logs (picker if omitted)
  ${C_CYAN}update restart${C_RESET} [service|all] restart a service
  ${C_CYAN}update prune${C_RESET}                 clean Docker (keeps volumes)
  ${C_CYAN}update disk${C_RESET}                  disk usage + data/ size
  ${C_CYAN}update health${C_RESET}                port + web UI + recent errors
  ${C_CYAN}update backup${C_RESET} [path]         tar of data/ (SQLite + uploads + config)
  ${C_CYAN}update restore${C_RESET} [file]        restore data/ from a backup (latest if omitted)
  ${C_CYAN}update shell${C_RESET} [service]       shell into a container
  ${C_CYAN}update help${C_RESET}                  this help

${C_BOLD}Release model:${C_RESET} ${C_DIM}'apply' deploys the highest 'vX.Y.Z' git tag.
  Cut a release from your dev machine:  git tag v1.0.1 && git push --tags
  Then on the LXC:  update apply
  Bleeding edge (NOT for prod):  KYOSEI_TRACK=main update apply  (or --main)${C_RESET}

${C_DIM}Old flags still work:${C_RESET}
  ${C_DIM}update --hard${C_RESET}    = update apply --hard
  ${C_DIM}update --no-pull${C_RESET} = update apply --no-pull
EOF
}

# --- Interactive menu (whiptail) ---------------------------------------------

menu_main_whiptail() {
  while true; do
    local title choice rc
    title="$APP_NAME  |  $(stack_summary)"
    choice=$(whiptail --backtitle "$WT_BACKTITLE" \
                      --title "$title" \
                      --menu "Choose an action:" \
                      $WT_H $WT_W $WT_MENU_H \
                      "1"  "Apply update      (pull + rebuild + restart)" \
                      "2"  "Hard update       (also patch base-image CVEs)" \
                      "3"  "OS update         (apt upgrade the LXC + auto-patch)" \
                      "4"  "Service status    (docker compose ps)" \
                      "5"  "Tail logs         (pick a service)" \
                      "6"  "Restart a service" \
                      "7"  "Shell into container" \
                      "8"  "Health check      (port / web UI / recent errors)" \
                      "9"  "Disk & storage    (df / data dir size)" \
                      "10" "Prune Docker      (frees space - keeps data)" \
                      "11" "Backup data       (SQLite + uploads to tar.gz)" \
                      "12" "Restore data      (from a backup tar.gz)" \
                      "13" "Web UI URL hint" \
                      "Q"  "Quit" \
                      3>&1 1>&2 2>&3)
    rc=$?
    [[ "$rc" -ne 0 ]] && { clear; echo "Bye."; exit 0; }

    clear; print_banner
    case "$choice" in
      1)  cmd_apply;          pause ;;
      2)  cmd_apply --hard;   pause ;;
      3)  cmd_os;             pause ;;
      4)  cmd_status;         pause ;;
      5)  cmd_logs ;;
      6)  cmd_restart;        pause ;;
      7)  cmd_shell ;;
      8)  cmd_health;         pause ;;
      9)  cmd_disk;           pause ;;
      10) cmd_prune;          pause ;;
      11) cmd_backup;         pause ;;
      12) cmd_restore;        pause ;;
      13)
          local ip; ip=$(hostname -I | awk '{print $1}')
          whiptail --backtitle "$WT_BACKTITLE" --title "Web UI" \
                   --msgbox "Local URL: http://$ip:${APP_PORT}\n\nOr your reverse-proxy hostname if configured (e.g. https://kyosei.example.com)." \
                   10 70
          ;;
      Q|q) clear; echo "Bye."; exit 0 ;;
      *) warn "Unknown choice: $choice"; sleep 1 ;;
    esac
  done
}

menu_main_plain() {
  while true; do
    print_banner
    cat <<EOF
  ${C_DIM}$(stack_summary)${C_RESET}

  ${C_BOLD}Updates${C_RESET}
   ${C_CYAN}1${C_RESET}) Apply update         (pull + rebuild + restart)
   ${C_CYAN}2${C_RESET}) Hard update          (also patch base-image CVEs)
   ${C_CYAN}3${C_RESET}) OS update            (apt upgrade the LXC + auto-patch)

  ${C_BOLD}Service control${C_RESET}
   ${C_CYAN}4${C_RESET}) Status
   ${C_CYAN}5${C_RESET}) Tail logs
   ${C_CYAN}6${C_RESET}) Restart a service
   ${C_CYAN}7${C_RESET}) Shell into a container

  ${C_BOLD}Maintenance${C_RESET}
   ${C_CYAN}8${C_RESET}) Health check
   ${C_CYAN}9${C_RESET}) Disk & storage
  ${C_CYAN}10${C_RESET}) Prune Docker
  ${C_CYAN}11${C_RESET}) Backup data
  ${C_CYAN}12${C_RESET}) Restore data

  ${C_CYAN}13${C_RESET}) Web UI URL hint
  ${C_CYAN} 0${C_RESET}) Quit

EOF
    printf "  Choose: "
    read -r choice < /dev/tty
    echo
    case "$choice" in
      1)  cmd_apply;          pause ;;
      2)  cmd_apply --hard;   pause ;;
      3)  cmd_os;             pause ;;
      4)  cmd_status;         pause ;;
      5)  cmd_logs ;;
      6)  cmd_restart;        pause ;;
      7)  cmd_shell ;;
      8)  cmd_health;         pause ;;
      9)  cmd_disk;           pause ;;
      10) cmd_prune;          pause ;;
      11) cmd_backup;         pause ;;
      12) cmd_restore;        pause ;;
      13)
          local ip; ip=$(hostname -I | awk '{print $1}')
          echo "  Web UI: http://$ip:${APP_PORT}"
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
  if [[ $# -eq 0 ]]; then menu_main; return; fi
  case "$1" in
    apply)    shift; cmd_apply "$@" ;;
    os)       cmd_os ;;
    status)   cmd_status ;;
    logs)     shift; cmd_logs "${1:-}" ;;
    restart)  shift; cmd_restart "${1:-}" ;;
    prune)    cmd_prune ;;
    disk)     cmd_disk ;;
    health)   cmd_health ;;
    backup)   shift; cmd_backup "${1:-}" ;;
    restore)  shift; cmd_restore "${1:-}" ;;
    shell)    shift; cmd_shell "${1:-}" ;;
    help|-h|--help) cmd_help ;;
    --hard|--no-pull) cmd_apply "$@" ;;
    *) err "Unknown subcommand: $1"; echo; cmd_help; exit 1 ;;
  esac
}

main "$@"
