package com.flowstate.app

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity

/**
 * FlowState's own browser for saved websites.
 * It is deliberately isolated from the app: no JavaScript bridge, no file access,
 * no third-party cookies, and only http(s) navigation is allowed.
 */
class BrowserActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private lateinit var address: EditText

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
        }

        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(8, 8, 8, 8)
        }

        fun tool(label: String, tip: String, action: () -> Unit) = Button(this).apply {
            text = label
            contentDescription = tip
            isAllCaps = false
            setOnClickListener { action() }
            bar.addView(this, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 0f).apply { width = dp(44) })
        }

        tool("‹", "Back") { if (webView.canGoBack()) webView.goBack() }
        tool("›", "Forward") { if (webView.canGoForward()) webView.goForward() }
        tool("⟳", "Refresh") { webView.reload() }

        address = EditText(this).apply {
            hint = "Search or enter a website"
            isSingleLine = true
            setText(intent.getStringExtra(EXTRA_URL) ?: "")
            setOnEditorActionListener { _, _, _ -> loadTyped(); true }
        }
        bar.addView(address, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

        bar.addView(Button(this).apply {
            text = "Go"
            isAllCaps = false
            setOnClickListener { loadTyped() }
        })
        bar.addView(Button(this).apply {
            text = "↗"
            contentDescription = "Open in another browser"
            isAllCaps = false
            setOnClickListener {
                val url = webView.url ?: return@setOnClickListener
                try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
                catch (_: Exception) { Toast.makeText(this@BrowserActivity, "No browser available", Toast.LENGTH_SHORT).show() }
            }
        })

        root.addView(bar)

        webView = WebView(this)
        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            useWideViewPort = true
            loadWithOverviewMode = true
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val scheme = request.url.scheme?.lowercase()
                if (scheme != "http" && scheme != "https") {
                    try { startActivity(Intent(Intent.ACTION_VIEW, request.url)) } catch (_: Exception) {}
                    return true
                }
                return false
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (!url.isNullOrBlank()) address.setText(url)
            }
        }
        root.addView(webView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        val hint = TextView(this).apply {
            text = "If a site refuses to load here, use ↗ to open it in another browser."
            textSize = 12f
            setPadding(dp(12), dp(6), dp(12), dp(10))
        }
        root.addView(hint)

        setContentView(root)

        val start = intent.getStringExtra(EXTRA_URL)
        if (!start.isNullOrBlank()) webView.loadUrl(normalise(start))
    }

    private fun loadTyped() {
        val typed = address.text?.toString()?.trim().orEmpty()
        if (typed.isBlank()) return
        webView.loadUrl(normalise(typed))
        address.clearFocus()
    }

    private fun normalise(input: String): String {
        val trimmed = input.trim()
        return if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) trimmed
        else if (trimmed.contains(' ') || !trimmed.contains('.')) "https://duckduckgo.com/?q=" + Uri.encode(trimmed)
        else "https://" + trimmed.removePrefix("//")
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    @Deprecated("Deprecated in Android API")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        if (::webView.isInitialized) {
            webView.stopLoading()
            webView.destroy()
        }
        super.onDestroy()
    }

    companion object {
        const val EXTRA_URL = "flowstate.browser.url"
    }
}
