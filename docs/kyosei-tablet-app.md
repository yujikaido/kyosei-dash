# Kyosei Dash on a Samsung tablet — PWA + WebView APK

Two ways to run Kyosei Dash as an "app" on the tablet. They are independent; you
can do either or both.

| | **PWA (Chrome)** | **WebView APK (recommended)** |
|---|---|---|
| Install effort | Install from Chrome menu | Build once in Android Studio, sideload |
| Self-signed cert | Must install the CA on the tablet (one-time Android setting) | **Bundled in the app — nothing to install on the tablet** |
| Updates | Automatic (reloads from server) | Content auto-updates; rebuild APK only to change the URL |
| Launch | Home-screen icon → Chrome shell | Home-screen icon → full-screen native shell |

Both require the dashboard to be reached over **HTTPS with a SAN certificate**. A
bare self-signed cert with only a Common Name will fail in modern Chrome
(`ERR_CERT_COMMON_NAME_INVALID`) and silently disables the PWA.

## Architecture: TLS is terminated at Nginx Proxy Manager (NPM)

```
tablet ──HTTPS (kyoseidash.admin:443)──► Nginx Proxy Manager ──HTTP──► Kyosei Dash (node)
                 ▲ cert lives here
```

Because NPM holds the certificate:

- The Kyosei Dash node server stays **plain HTTP** behind the proxy. You do **not**
  set `SSL_KEY` / `SSL_CERT` and do **not** need `generate-ssl-cert.ps1` on the
  server. Just `npm run build && npm start`.
- The address for both the PWA and the APK is **`https://kyoseidash.admin`**
  (standard port 443 — no `:3001`).
- The cert the tablet/app must trust is the one **NPM serves**, not anything on the
  node box.

## 0. Prepare NPM

1. **Enable Websockets Support** on the Kyosei Dash proxy host
   (NPM → Hosts → Proxy Hosts → edit → **Websockets Support** = on).
   Without it, socket.io can't connect and the dashboard never updates live.

2. **Confirm the cert has a SAN** and grab the exact cert the app will pin. From any
   machine that can reach the proxy (the server PC, or `openssl` on the tablet via
   Termux):
   ```bash
   # Check SAN — must list "DNS:kyoseidash.admin"
   echo | openssl s_client -connect kyoseidash.admin:443 -servername kyoseidash.admin 2>/dev/null \
     | openssl x509 -noout -ext subjectAltName

   # Export the served cert to a file (this is what you bundle in the APK / install for the PWA)
   echo | openssl s_client -connect kyoseidash.admin:443 -servername kyoseidash.admin 2>/dev/null \
     | openssl x509 -out kyosei_server.crt
   ```
   - If SAN is **missing**, the cert must be reissued with one. Generate a SAN cert
     with [`extra/generate-ssl-cert.ps1`](../extra/generate-ssl-cert.ps1), then in NPM
     → **SSL Certificates → Add → Custom** upload `server.crt` (certificate) and
     `server.key` (key). Re-run the export command afterward.
   - If SAN is **present**, you're set — `kyosei_server.crt` is your trust file.

> You can also copy the cert straight from the NPM container instead of exporting it:
> it lives at `/data/custom_ssl/npm-<id>/fullchain.pem` (custom) or
> `/etc/letsencrypt/live/npm-<id>/fullchain.pem` (Let's Encrypt).

Make sure the tablet can resolve `kyoseidash.admin` (router DNS, a Pi-hole/local DNS
entry, or the tablet's hosts file). If you'd rather use the LAN IP, the cert's SAN
must also include that IP.

---

## Part A — PWA (Chrome)

1. **Trust the cert on the tablet** (needed because it's self-signed):
   - Copy `kyosei_server.crt` (from step 0) to the tablet.
   - Settings → **Security and privacy** → **More security settings** →
     **Install from device storage** → **CA certificate** → **Install anyway** →
     pick the `.crt`.
   - Verify under **View security certificates** → *User* tab that it's listed.
   > Android 11+ only installs certs flagged as a CA (`basicConstraints CA:TRUE`).
   > A plain self-signed *leaf* may refuse to install here — if so, either reissue
   > via `generate-ssl-cert.ps1` (which makes a proper CA, install `certs/ca.crt`
   > instead) or just use the APK path, which has no such restriction.
2. On the tablet, open **Chrome** and go to `https://kyoseidash.admin`.
   The padlock should be clean — no warning.
3. Chrome menu (⋮) → **Add to Home screen** / **Install app**. The `共生` icon
   appears on the home screen and launches standalone (no address bar).

If "Install app" doesn't appear, the service worker didn't register — that almost
always means the cert isn't trusted (step 1) or the SAN doesn't match the address
you typed.

---

## Part B — WebView APK (recommended)

A ~5-file Android project that wraps the dashboard in a full-screen WebView and
trusts your cert **in the app**, so the tablet needs no CA install. Build it on
your other PC with Android Studio.

### Prerequisites (build PC)
- Android Studio (Hedgehog or newer).
- The cert NPM serves: `kyosei_server.crt` from step 0 (or NPM's `fullchain.pem`).
- Your server URL: `https://kyoseidash.admin`.

### Create the project
1. Android Studio → **New Project** → **Empty Views Activity**.
2. Name: `Kyosei Dash`, package: `com.kyosei.dash`, language: **Kotlin**,
   minimum SDK: **API 24**.
3. Replace/create the files below.

### `app/src/main/AndroidManifest.xml`
```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="Kyosei Dash"
        android:networkSecurityConfig="@xml/network_security_config"
        android:supportsRtl="true"
        android:theme="@style/Theme.KyoseiDash">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:configChanges="orientation|screenSize|keyboardHidden"
            android:screenOrientation="fullSensor"
            android:theme="@style/Theme.KyoseiDash">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
```

### `app/src/main/res/xml/network_security_config.xml`
Trusts **only** your CA, and **only** for your domain(s). Everything else on the
device is unaffected. Add a second `<domain-config>` block if you also browse by IP.
```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <domain-config>
        <domain includeSubdomains="true">kyoseidash.admin</domain>
        <trust-anchors>
            <certificates src="@raw/kyosei_ca" />
            <certificates src="system" />
        </trust-anchors>
    </domain-config>

    <!-- Uncomment and set your LAN IP if you launch by IP instead of hostname
    <domain-config>
        <domain includeSubdomains="false">192.168.1.50</domain>
        <trust-anchors>
            <certificates src="@raw/kyosei_ca" />
            <certificates src="system" />
        </trust-anchors>
    </domain-config>
    -->
</network-security-config>
```

### The cert file
Copy the cert NPM serves to `app/src/main/res/raw/kyosei_ca.crt`
(resource name must be `kyosei_ca` — lowercase, no dashes). Either file works as the
trust anchor:
- `kyosei_server.crt` (the exported leaf) — pins that exact cert; rebuild the APK
  whenever NPM's cert is replaced.
- `ca.crt` (if you issued the cert via `generate-ssl-cert.ps1`) — pins the CA, so
  re-signing the leaf with the same CA needs **no** APK rebuild. Preferred if you
  expect to rotate certs.

### `app/src/main/java/com/kyosei/dash/MainActivity.kt`
```kotlin
package com.kyosei.dash

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.View
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    // Change this to your server. Must match a domain in network_security_config.xml.
    private val startUrl = "https://kyoseidash.admin"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        // Full-screen, immersive
        window.decorView.systemUiVisibility =
            (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_FULLSCREEN)

        webView.settings.apply {
            javaScriptEnabled = true        // Vue app
            domStorageEnabled = true        // localStorage / session
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
        }

        // Keep all navigation inside the WebView (socket.io/WSS works automatically)
        webView.webViewClient = WebViewClient()

        // Back button navigates web history, then exits
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        webView.loadUrl(startUrl)
    }
}
```

### `app/src/main/res/values/themes.xml`
```xml
<resources xmlns:tools="http://schemas.android.com/tools">
    <style name="Theme.KyoseiDash" parent="Theme.AppCompat.NoActionBar">
        <item name="android:windowBackground">@android:color/black</item>
    </style>
</resources>
```

### Launcher icon
Use the generated `public/icon-512.png` from this repo:
Android Studio → right-click `res` → **New → Image Asset** → *Launcher Icons* →
Path = `icon-512.png`. It writes all the `mipmap-*` densities for you.

### Build + install
```bash
# From the Android project root, debug build (no signing needed for personal use):
./gradlew assembleDebug
# APK lands at app/build/outputs/apk/debug/app-debug.apk
```
Install on the tablet, either:
- **USB:** enable Developer options → USB debugging, then `adb install app-debug.apk`, or
- **Sideload:** copy the APK to the tablet, tap it, allow "Install unknown apps".

The `共生` icon appears in the app drawer and launches straight into the dashboard,
full-screen, with the cert already trusted.

### Changing the server address later
Edit `startUrl` in `MainActivity.kt` (and the domain in
`network_security_config.xml` if the hostname/IP changed), then `assembleDebug`
and reinstall. The dashboard *content* always updates live from the server — you
only rebuild the APK to point at a different address or swap the CA.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Chrome: "Your connection is not private" | Cert not trusted (PWA: install `ca.crt`) or SAN doesn't match the address. Regenerate with the correct `-Hostname`/`-IpAddress`. |
| PWA "Install app" missing | Not a secure context — fix the cert first. Confirm `/serviceWorker.js` loads with HTTP 200 over HTTPS. |
| APK: blank / `net::ERR_CERT_AUTHORITY_INVALID` | `ca.crt` missing from `res/raw/kyosei_ca.crt`, or the domain in `network_security_config.xml` doesn't match `startUrl`. |
| Dashboard loads but live updates stall (PWA or APK) | socket.io WSS is being dropped by the proxy — turn on **Websockets Support** for the proxy host in NPM. |
| Icon looks like a plain blue square | The `共生` glyph didn't rasterize in Image Asset — re-run with `icon-512.png` from `public/`. |
```
