package com.player

import android.app.Activity
import android.content.Intent
import android.net.Uri
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

class ProfilePhotoPicker(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context), ActivityEventListener {

    private var pendingPromise: Promise? = null

    init { context.addActivityEventListener(this) }

    override fun getName() = "ProfilePhotoPicker"

    @ReactMethod
    fun pickImage(promise: Promise) {
        if (pendingPromise != null) {
            promise.reject("EBUSY", "The photo picker is already open.")
            return
        }
        val activity = context.currentActivity
        if (activity == null) {
            promise.reject("ENOACTIVITY", "Groovix is not ready to open the gallery.")
            return
        }
        pendingPromise = promise
        activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "image/*"
        }, REQUEST_IMAGE)
    }

    @ReactMethod
    fun saveImage(temporaryUri: String, promise: Promise) {
        try {
            val source = File(requireNotNull(Uri.parse(temporaryUri).path))
            val cacheRoot = context.cacheDir.canonicalFile
            if (!source.canonicalFile.path.startsWith(cacheRoot.path) || !source.exists()) {
                promise.reject("EINVALID", "The selected photo is no longer available.")
                return
            }
            val profileDir = File(context.filesDir, "profile").apply { mkdirs() }
            profileDir.listFiles()?.filter { it.name.startsWith("avatar.") }?.forEach { it.delete() }
            val destination = File(profileDir, "avatar.${source.extension.ifBlank { "jpg" }}")
            source.copyTo(destination, overwrite = true)
            source.delete()
            promise.resolve(Uri.fromFile(destination).toString())
        } catch (error: Exception) {
            promise.reject("ESAVE", error.message, error)
        }
    }

    @ReactMethod
    fun removeSavedImage(promise: Promise) {
        try {
            File(context.filesDir, "profile").listFiles()
                ?.filter { it.name.startsWith("avatar.") }
                ?.forEach { it.delete() }
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject("EREMOVE", error.message, error)
        }
    }

    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQUEST_IMAGE) return
        val promise = pendingPromise ?: return
        pendingPromise = null
        if (resultCode != Activity.RESULT_OK || data?.data == null) {
            promise.resolve(null)
            return
        }
        try {
            val uri = requireNotNull(data.data)
            val mime = context.contentResolver.getType(uri).orEmpty()
            val extension = when {
                mime.contains("png") -> "png"
                mime.contains("webp") -> "webp"
                else -> "jpg"
            }
            val temporary = File(context.cacheDir, "profile-selection.$extension")
            context.contentResolver.openInputStream(uri).use { input ->
                requireNotNull(input) { "The selected photo could not be opened." }
                temporary.outputStream().use { output ->
                    val buffer = ByteArray(16 * 1024)
                    var total = 0L
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        total += read
                        require(total <= MAX_IMAGE_BYTES) { "Choose a photo smaller than 20 MB." }
                        output.write(buffer, 0, read)
                    }
                }
            }
            promise.resolve(Uri.fromFile(temporary).toString())
        } catch (error: Exception) {
            promise.reject("EPICK", error.message, error)
        }
    }

    override fun onNewIntent(intent: Intent) = Unit

    companion object {
        private const val REQUEST_IMAGE = 8402
        private const val MAX_IMAGE_BYTES = 20L * 1024L * 1024L
    }
}
