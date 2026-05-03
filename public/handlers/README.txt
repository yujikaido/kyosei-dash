Kyosei Dash — Windows URL handlers
===================================

Browsers won't natively launch rdp:// links. To make the RDP buttons in
Kyosei Dash actually open Microsoft Remote Desktop (mstsc.exe), download
and run the matching .reg file ONCE per Windows machine.

Files:
  rdp-handler.reg            Register rdp:// to launch mstsc.exe /v:<host>
  rdp-handler-uninstall.reg  Remove the registration

Install:
  1. Right-click the .reg file → Save As (or just download it)
  2. Double-click it. Windows will warn — Yes, then UAC → Yes
  3. Done. RDP buttons in Kyosei Dash now launch the Remote Desktop client.

The .reg only adds a single key under HKEY_CLASSES_ROOT\rdp. Inspect the
file in Notepad if you want to see exactly what it does — it's plain text.

Web (HTTP/HTTPS) buttons need no setup; browsers handle those natively.
