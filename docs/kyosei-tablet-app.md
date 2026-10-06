# Kyosei Dash tablet app (WebView APK)

A dead-simple Android app: install it, type the server address or IP, done. It
**accepts any TLS cert** (self-signed included) and remembers the address, so there
is nothing to export, bundle, or install on the tablet.

> Accept-any-cert is fine for a private LAN dashboard you control. Don't point this
> app at the public internet — it won't warn you about a bad/MITM cert.

Build it once on your build PC with Android Studio, then sideload the APK.

---

## Create the project
1. Android Studio → **New Project** → **Empty Views Activity**.
2. Name `Kyosei Dash`, package `com.kyosei.dash`, language **Kotlin**, min SDK **API 24**.
3. Replace/create the four files below.

### `app/src/main/AndroidManifest.xml`
```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="Kyosei Dash"
        android:usesCleartextTraffic="true"
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
`usesCleartextTraffic="true"` lets you type a plain `http://192.168.x.x:3001`
too, if you ever bypass the proxy.

### `app/src/main/res/values/themes.xml`
```xml
<resources>
    <style name="Theme.KyoseiDash" parent="Theme.AppCompat.NoActionBar">
        <item name="android:windowBackground">@android:color/black</item>
    </style>
</resources>
```

### `app/src/main/java/com/kyosei/dash/MainActivity.kt`
```kotlin
package com.kyosei.dash

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Context
import android.net.http.SslError
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.webkit.SslErrorHandler
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private val prefs by lazy { getSharedPreferences("kyosei", Context.MODE_PRIVATE) }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)

        webView.settings.apply {
            javaScriptEnabled = true          // Vue app
            domStorageEnabled = true          // localStorage / session
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
        }

        webView.webViewClient = object : WebViewClient() {
            // Accept any cert (self-signed, hostname mismatch, expired) — LAN app.
            override fun onReceivedSslError(
                view: WebView?, handler: SslErrorHandler?, error: SslError?
            ) {
                handler?.proceed()
            }
        }

        // Full-screen WebView + a faint gear button (top-right) to change the address.
        val root = FrameLayout(this)
        root.addView(webView)
        val gear = Button(this).apply {
            text = "⚙"            // ⚙
            alpha = 0.35f
            setOnClickListener { askForAddress() }
        }
        root.addView(
            gear,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP or Gravity.END
            )
        )
        setContentView(root)

        window.decorView.systemUiVisibility =
            (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_FULLSCREEN)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        val saved = prefs.getString("url", null)
        if (saved.isNullOrBlank()) askForAddress() else webView.loadUrl(saved)
    }

    /** Prompt for the server address/IP, save it, and load it. */
    private fun askForAddress() {
        val current = prefs.getString("url", "") ?: ""
        val input = EditText(this).apply {
            hint = "192.168.1.50   or   kyoseidash.admin"
            setText(current)
            setSelection(text.length)
        }
        AlertDialog.Builder(this)
            .setTitle("Server address")
            .setView(input)
            .setCancelable(current.isNotBlank())
            .setPositiveButton("Connect") { _, _ ->
                val url = normalize(input.text.toString())
                prefs.edit().putString("url", url).apply()
                webView.loadUrl(url)
            }
            .show()
    }

    /** Add https:// if the user didn't type a scheme. */
    private fun normalize(raw: String): String {
        val t = raw.trim()
        return if (t.startsWith("http://") || t.startsWith("https://")) t else "https://$t"
    }
}
```

### Launcher icon
Use `public/icon-512.png` from this repo: Android Studio → right-click `res` →
**New → Image Asset** → *Launcher Icons* → Path = `icon-512.png`. It generates every
density. (That's the only reason the icons were added — they're otherwise optional.)

---

## Build + install
```bash
# From the Android project root — debug build, no signing needed for personal use
./gradlew assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```
Put it on the tablet by either:
- **USB:** enable Developer options → USB debugging, then `adb install app-debug.apk`, or
- **Sideload:** copy the APK over, tap it, allow "Install unknown apps".

## Using it
1. First launch → type the address: just the IP (`192.168.1.50`) or the name
   (`kyoseidash.admin`). It prepends `https://` automatically; type the full
   `http://...:3001` if you want plain HTTP instead.
2. It remembers it and goes straight in next time.
3. Tap the faint **⚙** top-right to change the address anytime.

## If live updates stall
The dashboard uses websockets (socket.io). Through Nginx Proxy Manager, turn on
**Websockets Support** for the Kyosei proxy host (NPM → Proxy Hosts → edit →
Websockets Support). Nothing to change in the app.

---

## Appendix — Chrome PWA (optional, no APK)
The repo is also PWA-installable. In Chrome on the tablet, open the dashboard →
menu ⋮ → **Install app**. Caveat: Chrome refuses to register the service worker on a
self-signed cert it doesn't trust, so the PWA only works if the cert is trusted on
the tablet. The APK above sidesteps that entirely — prefer it.
