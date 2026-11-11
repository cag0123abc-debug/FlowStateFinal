package com.flowstate.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.webkit.JavascriptInterface
import android.widget.Toast
import org.json.JSONArray
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Encrypts user-supplied secrets (Google sync endpoint/token, optional AI key)
 * with an AES-GCM key that never leaves the Android Keystore.
 * Nothing secret is ever compiled into the app.
 */
object SecureStore {
    private const val PREFS = "flowstate_secure"
    private const val ALIAS = "flowstate_master_v1"

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(
                ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build()
        )
        return gen.generateKey()
    }

    fun put(context: Context, name: String, value: String) {
        try {
            if (value.isEmpty()) { remove(context, name); return }
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key())
            val ct = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
            val packed = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" +
                Base64.encodeToString(ct, Base64.NO_WRAP)
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putString(name, packed).apply()
        } catch (_: Exception) {
        }
    }

    fun get(context: Context, name: String): String {
        return try {
            val packed = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(name, null) ?: return ""
            val parts = packed.split(":")
            if (parts.size != 2) return ""
            val iv = Base64.decode(parts[0], Base64.NO_WRAP)
            val ct = Base64.decode(parts[1], Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
            String(cipher.doFinal(ct), Charsets.UTF_8)
        } catch (_: Exception) {
            ""
        }
    }

    fun remove(context: Context, name: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(name).apply()
    }
}

/**
 * Small, deliberately narrow JavaScript bridge. It is only reachable from the
 * bundled app page loaded into MainActivity; arbitrary websites never get this
 * object because they open in BrowserActivity, which installs no bridge.
 */
class NativeBridge(private val activity: MainActivity) {

    @JavascriptInterface
    fun readSecret(name: String?): String =
        if (name.isNullOrBlank()) "" else SecureStore.get(activity, name)

    @JavascriptInterface
    fun saveSecret(name: String?, value: String?) {
        if (name.isNullOrBlank()) return
        SecureStore.put(activity, name, value ?: "")
    }

    @JavascriptInterface
    fun deleteSecret(name: String?) {
        if (!name.isNullOrBlank()) SecureStore.remove(activity, name)
    }

    /** Files that arrived through the Android share sheet and are waiting to be imported. */
    @JavascriptInterface
    fun pendingShares(): String = Shares.pendingJson(activity)

    @JavascriptInterface
    fun sharedSize(id: String?): Long = Shares.sizeOf(activity, id)

    @JavascriptInterface
    fun readSharedChunk(id: String?, offset: Int, length: Int): String =
        Shares.readChunk(activity, id, offset, length)

    @JavascriptInterface
    fun clearShare(id: String?) {
        Shares.clear(activity, id)
    }

    @JavascriptInterface
    fun openBrowser(url: String?) {
        if (url.isNullOrBlank()) return
        activity.startActivity(
            Intent(activity, BrowserActivity::class.java).putExtra(BrowserActivity.EXTRA_URL, url)
        )
    }

    @JavascriptInterface
    fun openExternal(url: String?) {
        if (url.isNullOrBlank()) return
        try {
            activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (_: Exception) {
            Toast.makeText(activity, "No app can open this link", Toast.LENGTH_SHORT).show()
        }
    }

    @JavascriptInterface
    fun toast(message: String?) {
        if (!message.isNullOrBlank()) {
            activity.runOnUiThread {
                Toast.makeText(activity, message, Toast.LENGTH_SHORT).show()
            }
        }
    }

    @JavascriptInterface
    fun appVersion(): String = BuildConfig.VERSION_NAME
}

/** Shared-file bookkeeping: copies live under filesDir/shared/<id>/ and survive reboots. */
object Shares {
    private const val PREFS = "flowstate_shares"
    private const val KEY = "pending"

    fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun pending(context: Context): JSONArray {
        val raw = prefs(context).getString(KEY, "[]") ?: "[]"
        return try { JSONArray(raw) } catch (_: Exception) { JSONArray() }
    }

    fun pendingJson(context: Context): String = pending(context).toString()

    fun fileFor(context: Context, id: String?): File? {
        if (id.isNullOrBlank()) return null
        if (!id.matches(Regex("[A-Za-z0-9-]{6,64}"))) return null
        val dir = File(context.filesDir, "shared/$id")
        if (!dir.isDirectory) return null
        return dir.listFiles()?.firstOrNull { it.isFile }
    }

    fun sizeOf(context: Context, id: String?): Long = fileFor(context, id)?.length() ?: 0L

    fun readChunk(context: Context, id: String?, offset: Int, length: Int): String {
        val f = fileFor(context, id) ?: return ""
        if (offset < 0 || length <= 0 || offset >= f.length()) return ""
        return try {
            java.io.RandomAccessFile(f, "r").use { raf ->
                raf.seek(offset.toLong())
                val buf = ByteArray(minOf(length, 1024 * 1024))
                val read = raf.read(buf)
                if (read <= 0) "" else Base64.encodeToString(buf, 0, read, Base64.NO_WRAP)
            }
        } catch (_: Exception) {
            ""
        }
    }

    fun clear(context: Context, id: String?) {
        if (id.isNullOrBlank()) return
        try { File(context.filesDir, "shared/$id").deleteRecursively() } catch (_: Exception) {}
        val arr = pending(context)
        val kept = JSONArray()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            if (o.optString("id") != id) kept.put(o)
        }
        prefs(context).edit().putString(KEY, kept.toString()).apply()
    }
}
