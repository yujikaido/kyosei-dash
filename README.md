<div align="center" width="100%">
    <h1>共生</h1>
    <h2>Kyosei Dash</h2>
    <p><em>Symbiosis for monitoring.</em></p>
</div>

---

> **Uptime Kuma handles *"is it up?"* · PRTG handles *"what is it doing?"* · Kyosei Dash unifies both, adds *"let me jump to it."***

Kyosei Dash (共生 — *kyōsei*, "living together") is a self-hosted monitoring dashboard that combines two complementary engines into one pane of glass:

- **Uptime Kuma** — HTTP, ping, TCP, DNS, databases, 2FA, status pages, 60+ notification providers
- **PRTG** — SNMP bandwidth, ping quality, hardware, WMI, NetFlow, vendor sensors, any custom PRTG probe
- **Kyosei Dash** — click-to-connect launchers (RDP, SSH, HTTP/HTTPS, Custom URL) on every monitor, a capability-aware PRTG importer, JSON backup/restore, and bulk operations across selected monitors

---

## 🚀 Installation

### Option 1: Proxmox LXC (Automated — recommended)

For anyone running Proxmox VE, deploy a fully configured **Debian 13 LXC** running Docker with a single command on your Proxmox host shell:

```bash
bash -c "$(wget -qLO - https://raw.githubusercontent.com/yujikaido/kyosei-dash/main/deploy/proxmox-install.sh)"
```

You'll get an interactive whiptail menu — **Install** or **Update** — with prompts for CTID, hostname, storage, cores, RAM, and disk. Everything else is automatic.

### Option 2: Universal Docker (Windows, Mac, Linux, any NAS)

If you don't use Proxmox, run Kyosei Dash anywhere Docker is installed.

1. Download this repository (Code → Download ZIP, or `git clone`).
2. Install **Docker Desktop** (Windows/Mac) or **Docker Engine** (Linux).
3. In the project folder:
   ```bash
   docker compose up -d --build
   ```
4. Open `http://<host-ip>:3001`.

### **Installer Features:**
* **Interactive TUI** — whiptail-driven menu handles fresh installs and rolling updates.
* **Smart Defaults** — auto-picks the next free CTID, auto-detects the latest Debian 13 template, falls back to Debian 12 if 13 is unavailable.
* **Unprivileged LXC** — deploys as a secure unprivileged container with `nesting=1` + `keyctl=1` (exactly what Docker-in-LXC needs, nothing more).
* **Credentials stay server-side** — the browser only sees `{ hasPasshash: bool }` flags; PRTG passwords and API tokens never leave the container.
* **Zero-config `update` alias** — inside the LXC, type `update` to apt-upgrade the OS, pull the latest code, and rebuild Docker in one command.

---

## 📖 First-Run Guide

Once installed, Kyosei Dash is at `http://<lxc-ip>:3001`.

1. **Create the admin account** (Kuma-style setup wizard on first load).
2. **Settings → PRTG Servers** → **Add PRTG Server**
   - Name, URL, username + passhash (or API token)
   - Tick **Ignore SSL** if your PRTG has a self-signed cert
   - **Test Connection** before saving
3. **PRTG Import** (top nav) → pick the server → review the sensor list
   - Green-badge rows (PRTG-only) are pre-ticked
   - Yellow-badge rows (Kuma-native) are left unticked — Kuma will probe those natively
   - Adjust per-row, click **Import**
4. **Dashboard** → toggle **List / Devices** view to group by device
5. **Network** (top nav) → top-throughput / latency / loss / errors leaderboards
6. **Settings → Backup & Restore** to round-trip a JSON containing all monitors and groups (Kuma 2.x dropped this; Kyosei brings it back). Selective restore is safe — only creates new monitors, never touches existing ones.
7. **Edit Monitor → Connection Launchers** to add RDP / SSH / Web / Custom click-to-connect buttons on any monitor.
   - **Windows users:** browsers don't natively launch `rdp://` URIs. Download the one-time handler at `http://<lxc-ip>:3001/handlers/rdp-handler.reg` and double-click it; RDP buttons will then launch `mstsc.exe` directly.

---

## 🧭 Architecture

```
┌────────────────────────────────────────────────────────┐
│                   Kyosei Dash                          │
│  Vue SPA + Socket.IO + Express + SQLite (Kuma's DB)    │
│                                                        │
│   Native monitors (ping/http/dns/tcp/...) — Kuma       │
│   PRTG monitor type (new) — bridge to existing PRTG    │
│   Capability-aware importer — no duplicate probes      │
│   Connection launchers — RDP/SSH/HTTP/Custom           │
│   Bulk ops: group-by-device / move / set device /      │
│             add launcher across N monitors at once     │
│   JSON backup + restore (round-trip, includes Kyosei   │
│             extras: connections + PRTG bindings)       │
└──────────────────┬─────────────────────────────────────┘
                   │ JSON API
                   ▼
              ┌──────────┐
              │ Your PRTG│
              └──────────┘
```

## ✅ What works (verified on a live PRTG install)

- Importing PRTG sensors with capability-aware skip/import classification
- `prtg` monitor type polls via the JSON API and writes channels to the heartbeat row
- Bandwidth / latency charts auto-scale (`Mbit/s` / `Gbit/s` y-axis, PRTG-style x-axis labels)
- `/network` overview leaderboards: top throughput, highest latency, packet loss, interface errors
- Settings → **PRTG Servers** registry with credential sanitization (browser only sees boolean flags, never plaintext)
- Settings → **Backup & Restore** — full JSON round-trip; selective restore by source group; Kuma v1 backups can be imported too
- Bulk Actions on selected monitors:
  - Move to group / Set device / Add connection launcher / Group by device under… (auto-creates per-device sub-groups)
- Selecting a group monitor cascades to all descendants
- RDP `.reg` handler bundled at `/handlers/rdp-handler.reg`
- Newly imported monitors auto-start polling (no pause/resume needed)
- Times rendered in browser-local timezone (server stores UTC, serializes ISO)
- Proxmox LXC installer with `update` alias for one-shot upgrades

## 🚧 Known limits

- The `/network` page leaderboards use English-language regex on PRTG channel names; non-English PRTG installs may miss matches
- 7-day chart data depends on having 7 days of accumulated heartbeats — fresh installs show only what they've collected so far
- Default DB is SQLite; the channel-history query uses SQLite-specific date math. MariaDB/Postgres backends would need a small SQL tweak.
- VNC and Telnet launcher types are not currently wired in the UI (RDP / SSH / Web / Custom only)

## 📦 Version

`1.0.0-beta`

---

## Credits

Built on [Uptime Kuma](https://github.com/louislam/uptime-kuma) by Louis
Lam (MIT). Kuma's original license is preserved verbatim as
[`LICENSE-UPSTREAM`](LICENSE-UPSTREAM).

PRTG® is a registered trademark of Paessler AG. Kyosei Dash is
independent and unaffiliated with either Uptime Kuma or Paessler AG.
