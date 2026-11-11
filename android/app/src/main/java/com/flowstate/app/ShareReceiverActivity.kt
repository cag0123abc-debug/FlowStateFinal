package com.flowstate.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/**
 * Receives Samsung Voice Recorder (and any other app's) share intents.
 * Every shared file is copied into FlowState's private storage immediately, so the
 * import keeps working even after the sender deletes or revokes the original.
 * A shared transcript (.txt/.srt/.vtt or text/plain) is attached to the recording.
 */
class ShareReceiverActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            handle(intent)
        } catch (_: Exception) {
        }
        startActivity(
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        )
        finish()
    }

    private fun handle(intent: Intent?) {
        if (intent == null) return
        val uris = ArrayList<Uri>()
        when (intent.action) {
            Intent.ACTION_SEND -> streamOf(intent)?.let { uris.add(it) }
            Intent.ACTION_SEND_MULTIPLE ->
                @Suppress("DEPRECATION")
                intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)?.let { uris.addAll(it) }
        }
        val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT).orEmpty()
        val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT).orEmpty()
        if (uris.isEmpty() && sharedText.isBlank()) return

        val pending = Shares.pending(this)
        var transcript = ""
        val audioEntries = JSONArray()

        uris.forEach { uri ->
            val mime = contentResolver.getType(uri) ?: "application/octet-stream"
            val name = displayName(uri) ?: "shared-${System.currentTimeMillis()}"
            val safe = name.replace(Regex("[^A-Za-z0-9._ -]"), "_").take(90).ifBlank { "shared.bin" }
            val id = UUID.randomUUID().toString()
            val dir = File(filesDir, "shared/$id").apply { mkdirs() }
            val dest = File(dir, safe)
            var copied = false
            try {
                contentResolver.openInputStream(uri)?.use { input ->
                    dest.outputStream().use { output -> input.copyTo(output) }
                    copied = true
                }
            } catch (_: Exception) {
                copied = false
            }
            val lower = safe.lowercase()
            val isText = mime.startsWith("text/") ||
                lower.endsWith(".txt") || lower.endsWith(".srt") ||
                lower.endsWith(".vtt") || lower.endsWith(".md")
            if (isText && copied) {
                transcript = runCatching { dest.readText() }.getOrDefault("").take(400_000)
                try { dir.deleteRecursively() } catch (_: Exception) {}
                return@forEach
            }
            if (!copied) return@forEach
            audioEntries.put(
                JSONObject().apply {
                    put("id", id)
                    put("name", safe)
                    put("mime", mime)
                    put("size", dest.length())
                    put("hasAudio", true)
                    put("transcriptText", "")
                }
            )
        }

        val effectiveTranscript = transcript.ifBlank { sharedText }.take(400_000)
        if (audioEntries.length() > 0) {
            val first = audioEntries.optJSONObject(0)
            if (first != null) first.put("transcriptText", effectiveTranscript)
            for (i in 0 until audioEntries.length()) pending.put(audioEntries.optJSONObject(i))
        } else if (effectiveTranscript.isNotBlank()) {
            pending.put(
                JSONObject().apply {
                    put("id", UUID.randomUUID().toString())
                    put("name", subject.ifBlank { "Shared note" })
                    put("mime", "text/plain")
                    put("size", effectiveTranscript.length)
                    put("hasAudio", false)
                    put("transcriptText", effectiveTranscript)
                }
            )
        }
        Shares.prefs(this).edit().putString("pending", pending.toString()).apply()
    }

    @Suppress("DEPRECATION")
    private fun streamOf(intent: Intent): Uri? = intent.getParcelableExtra(Intent.EXTRA_STREAM)

    private fun displayName(uri: Uri): String? {
        return try {
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
        } catch (_: Exception) {
            uri.lastPathSegment
        }
    }
}
