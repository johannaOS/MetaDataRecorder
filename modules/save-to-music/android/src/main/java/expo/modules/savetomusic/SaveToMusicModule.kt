package expo.modules.savetomusic

import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream

class SaveToMusicModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SaveToMusic")

    // Returns a content:// URI (Android 10+) or file:// URI (Android 9-)
    // pointing to the saved file in Music/VoiceRecorder/.
    AsyncFunction("saveAudioFile") { localUri: String, displayName: String ->
      saveToVoiceRecorder(localUri, displayName)
    }

    // Deletes a MediaStore entry by content:// URI.
    // Returns true if a row was deleted, false on failure or if not found.
    AsyncFunction("deleteAudioFile") { uri: String ->
      deleteFromMediaStore(uri)
    }
  }

  private fun deleteFromMediaStore(uri: String): Boolean {
    return try {
      val parsedUri = android.net.Uri.parse(uri)
      val resolver = requireNotNull(appContext.reactContext).contentResolver
      resolver.delete(parsedUri, null, null) > 0
    } catch (e: Exception) {
      false
    }
  }

  private fun saveToVoiceRecorder(localUri: String, displayName: String): String {
    // Uri.parse().path decodes percent-encoded characters (e.g. %C3%A5 → å),
    // so filenames with Swedish characters or special chars work correctly.
    val filePath = Uri.parse(localUri).path
      ?: throw IllegalArgumentException("Cannot extract path from URI: $localUri")
    val source = File(filePath)
    check(source.exists()) { "Source file not found: $filePath" }

    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      saveViaMediaStore(source, displayName)
    } else {
      saveDirectly(source, displayName)
    }
  }

  // Android 10+ (API 29+): insert via MediaStore.Audio so the file appears in
  // Music/VoiceRecorder/ and is indexed by the media scanner immediately.
  // IS_PENDING=1 reserves the slot while writing, IS_PENDING=0 makes it visible.
  private fun saveViaMediaStore(source: File, displayName: String): String {
    val resolver = requireNotNull(appContext.reactContext).contentResolver

    val pending = ContentValues().apply {
      put(MediaStore.Audio.Media.DISPLAY_NAME, displayName)
      put(MediaStore.Audio.Media.MIME_TYPE, "audio/mp4")
      put(MediaStore.Audio.Media.RELATIVE_PATH, "Music/VoiceRecorder")
      put(MediaStore.Audio.Media.IS_PENDING, 1)
    }

    val uri = resolver.insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, pending)
      ?: error("MediaStore insert returned null")

    try {
      resolver.openOutputStream(uri)!!.use { out ->
        FileInputStream(source).use { it.copyTo(out) }
      }
      val ready = ContentValues().apply { put(MediaStore.Audio.Media.IS_PENDING, 0) }
      resolver.update(uri, ready, null, null)
    } catch (e: Exception) {
      resolver.delete(uri, null, null) // clean up the pending slot on failure
      throw e
    }

    return uri.toString()
  }

  // Android 9 (API 28) and below: direct filesystem write.
  // WRITE_EXTERNAL_STORAGE permission covers this path on these older versions.
  private fun saveDirectly(source: File, displayName: String): String {
    @Suppress("DEPRECATION")
    val musicDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC)
    val destDir = File(musicDir, "VoiceRecorder").also { it.mkdirs() }
    val dest = File(destDir, displayName)
    source.copyTo(dest, overwrite = false)
    return "file://${dest.absolutePath}"
  }
}
