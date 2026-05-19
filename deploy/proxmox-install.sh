#!/usr/bin/env bash

# ==========================================================================================
# 共生 Kyosei Dash — Proxmox LXC Installer
# Uptime Kuma engine · PRTG data · Click-to-connect everywhere.
# Adapted from PRTG Dash's installer.
# ==========================================================================================

set -e

# --- Config ---
REPO_URL="${REPO_URL:-https://github.com/yujikaido/kyosei-dash.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
APP_PORT="${APP_PORT:-3001}"
APP_DIR="/opt/kyosei-dash"

# --- UI Helper Functions ---
function msg_box() {
    whiptail --title "Kyosei Dash" --msgbox "$1" 12 70
}
function ask_yesno() {
    whiptail --title "Kyosei Dash" --yesno "$1" 12 70
}
function get_input() {
    whiptail --title "Kyosei Dash" --inputbox "$1" 12 70 "$2" 3>&1 1>&2 2>&3
}
function get_password() {
    whiptail --title "Kyosei Dash" --passwordbox "$1" 12 70 3>&1 1>&2 2>&3
}

# --- Sanity checks ---
if [[ $EUID -ne 0 ]]; then
    echo "ERROR: run this on the Proxmox host as root." >&2
    exit 1
fi
for bin in pct pveam pvesh pvesm whiptail; do
    command -v "$bin" >/dev/null || { echo "ERROR: '$bin' not found — is this a Proxmox host?" >&2; exit 1; }
done

clear
cat <<'EOF'
  _  __                   _   ____            _
 | |/ /   _  ___  ___  ___(_) |  _ \  __ _ ___| |__
 | ' / | | |/ _ \/ __|/ _ \ | | | | |/ _` / __| '_ \
 | . \ |_| | (_) \__ \  __/ | | |_| | (_| \__ \ | | |
 |_|\_\__, |\___/|___/\___|_| |____/ \__,_|___/_| |_|
      |___/

  共生  Symbiosis for monitoring
  Uptime Kuma engine · PRTG data · Click-to-connect
EOF

ACTION=$(whiptail --title "Kyosei Dash" --menu "Welcome! Select an action:" 15 70 2 \
    "install" "Install a new Kyosei Dash container" \
    "update"  "Update an existing Kyosei Dash container" 3>&1 1>&2 2>&3)

if [ "$ACTION" == "update" ]; then
    DEFAULT_CT=$(pct list | awk 'tolower($0) ~ /kyosei/ {print $1}' | head -n 1)
    CT_ID=$(get_input "Enter the existing LXC ID to update:" "$DEFAULT_CT")
    if [ -z "$CT_ID" ]; then echo "Cancelled."; exit 0; fi
    if ! pct status "$CT_ID" &>/dev/null; then
        echo "ERROR: container $CT_ID does not exist."; exit 1
    fi
    echo "Updating OS + pulling latest code + rebuilding image..."
    pct exec "$CT_ID" -- bash -c "
        set -e
        export DEBIAN_FRONTEND=noninteractive
        apt-get update -qq && apt-get upgrade -y -qq
        cd $APP_DIR
        git pull
        docker compose up -d --build
    "
    IP=$(pct exec "$CT_ID" -- hostname -I | awk '{print $1}')
    msg_box "Update complete.\n\nKyosei Dash: http://${IP}:${APP_PORT}"
    exit 0
elif [ -z "$ACTION" ]; then
    echo "Cancelled."
    exit 0
fi

# --- Gather Configuration ---
NEXT_ID=$(pvesh get /cluster/nextid)
CT_ID=$(get_input "Desired Container ID:" "$NEXT_ID")
CT_HOSTNAME=$(get_input "Hostname (DNS friendly):" "kyoseidash")
CT_PASSWORD=$(get_password "Root password for the container:")
[ -z "$CT_PASSWORD" ] && { echo "Password required."; exit 1; }

STORAGE_LIST=$(pvesm status | grep -E "dir|lvm|zfspool|btrfs" | awk '{print $1 " " $2}' | xargs)
CT_STORAGE=$(whiptail --title "Kyosei Dash" --menu "Storage pool for the container:" 15 70 6 $(echo $STORAGE_LIST) 3>&1 1>&2 2>&3)
[ -z "$CT_STORAGE" ] && { echo "Cancelled."; exit 0; }

CT_CORES=$(get_input "CPU cores:" "2")
CT_RAM=$(get_input "RAM (MiB):" "2048")
CT_DISK=$(get_input "Disk size (GB):" "10")

CT_OS=$(whiptail --title "Kyosei Dash" --menu "Host OS for the container:" 15 70 2 \
    "debian-13" "Debian 13 (Trixie) — Recommended" \
    "debian-12" "Debian 12 (Bookworm)" 3>&1 1>&2 2>&3)
[ -z "$CT_OS" ] && CT_OS="debian-13"

# --- Host Preparation ---
echo "Initializing host environment..."
if ! command -v git &>/dev/null; then
    apt-get update -qq && apt-get install -y -qq git
fi

# --- Download Template ---
echo "Looking up the latest $CT_OS template..."
pveam update &>/dev/null
TEMPLATE=$(pveam available --section system | awk -v p="$CT_OS" '$2 ~ p {print $2}' | sort -V | tail -n1)
if [ -z "$TEMPLATE" ] && [ "$CT_OS" == "debian-13" ]; then
    echo "⚠️  Debian 13 template not found — falling back to Debian 12..."
    TEMPLATE=$(pveam available --section system | awk '$2 ~ /debian-12/ {print $2}' | sort -V | tail -n1)
fi
[ -z "$TEMPLATE" ] && { echo "ERROR: no usable template available from pveam."; exit 1; }

if ! pvesm list local | grep -q "$TEMPLATE"; then
    echo "Downloading $TEMPLATE..."
    pveam download local "$TEMPLATE"
else
    echo "Template already present: $TEMPLATE"
fi

# --- Container Creation ---
echo "Creating LXC $CT_ID..."
pct create "$CT_ID" "local:vztmpl/$TEMPLATE" \
    --hostname   "$CT_HOSTNAME" \
    --password   "$CT_PASSWORD" \
    --storage    "$CT_STORAGE" \
    --memory     "$CT_RAM" \
    --swap       512 \
    --cores      "$CT_CORES" \
    --rootfs     "$CT_STORAGE:$CT_DISK" \
    --net0       "name=eth0,bridge=vmbr0,ip=dhcp" \
    --unprivileged 1 \
    --features   "nesting=1,keyctl=1" \
    --onboot     1 \
    --timezone   host

# --- Start & Wait for Network ---
echo "Starting container..."
pct start "$CT_ID"
for i in {1..30}; do
    if pct exec "$CT_ID" -- sh -c 'ping -c1 -W1 deb.debian.org >/dev/null 2>&1'; then
        break
    fi
    sleep 2
    [ "$i" -eq 30 ] && { echo "ERROR: no network in container after 60s."; exit 1; }
done

# --- Application Setup (inside container) ---
echo "Installing Docker and deploying Kyosei Dash (first build takes a few minutes)..."
pct exec "$CT_ID" -- bash -c "
set -e
export DEBIAN_FRONTEND=noninteractive

echo '--> apt update + base packages'
apt-get update -qq
apt-get install -y -qq curl ca-certificates git gnupg openssl

echo '--> installing Docker CE'
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

echo '--> cloning $REPO_URL'
rm -rf '$APP_DIR'
git clone '$REPO_URL' '$APP_DIR'
cd '$APP_DIR'
# SECURITY: deploy the latest *tagged release*, not raw main. A human must
# deliberately tag a reviewed commit for it to land on a production node.
LATEST_TAG=\$(git tag -l 'v*' --sort=-v:refname | head -1)
if [ -n \"\$LATEST_TAG\" ]; then
    echo \"--> checking out release \$LATEST_TAG\"
    git checkout --quiet \"\$LATEST_TAG\"
else
    echo '--> WARNING: no version tags found; staying on default branch (main)'
    echo '    Tag a release on your dev box: git tag v1.0.0 && git push --tags'
fi

echo '--> building + starting stack'
docker compose up -d --build

echo '--> installing operator console (update command)'
chmod +x '$APP_DIR/update.sh' 2>/dev/null || true
apt-get install -y -qq whiptail 2>/dev/null || true
cat > /usr/local/bin/update <<UPD
#!/bin/bash
exec '$APP_DIR/update.sh' \"\\\$@\"
UPD
chmod +x /usr/local/bin/update

echo '--> waiting for app to come up'
for i in \$(seq 1 30); do
    if curl -fsS http://127.0.0.1:${APP_PORT}/ >/dev/null 2>&1; then
        echo '    ready.'
        break
    fi
    sleep 2
done
"

# --- Finalization ---
IP=$(pct exec "$CT_ID" -- hostname -I | awk '{print $1}')
msg_box "Deployment finished!\n\nKyosei Dash URL:\n  http://${IP}:${APP_PORT}\n\nFirst run: create an admin account,\nthen add a PRTG server under Settings → PRTG Servers.\n\nQuick update (inside LXC): run 'update'"

cat <<EOF

============================================================
  ✅  Kyosei Dash is live!

  LXC:      $CT_ID  ($CT_HOSTNAME)
  IP:       $IP
  Web UI:   http://${IP}:${APP_PORT}

  First-run:  create admin account, then Settings → PRTG
              Servers to register your PRTG instance, then
              PRTG Import to pull sensors.

  Manage:
    pct enter $CT_ID                 # shell into the LXC
    update                           # apt upgrade + git pull + rebuild
    cd $APP_DIR && docker compose logs -f
============================================================
EOF
