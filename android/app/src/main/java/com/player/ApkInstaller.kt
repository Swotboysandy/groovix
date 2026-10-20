package com.player

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * Native module that triggers Android's package installer for a downloaded APK.
 * Uses FileProvider so the content:// URI is readable by the installer on Android 7+.
 */
class ApkInstaller(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "ApkInstaller"

    @ReactMethod
    fun getAndroidId(promise: Promise) {
        try {
            val androidId = Settings.Secure.getString(
                reactApplicationContext.contentResolver,
                Settings.Secure.ANDROID_ID
            )
            if (androidId.isNullOrBlank()) {
                promise.reject("ENOANDROIDID", "Android device ID is unavailable")
                return
            }
            promise.resolve(androidId)
        } catch (e: Exception) {
            promise.reject("EANDROIDID", e.message, e)
        }
    }

    @ReactMethod
    fun install(filePath: String, promise: Promise) {
        try {
            val ctx = reactApplicationContext
            val file = File(filePath)
            if (!file.exists()) {
                promise.reject("ENOFILE", "APK not found at $filePath")
                return
            }

            val uri: Uri = FileProvider.getUriForFile(
                ctx, "${ctx.packageName}.provider", file
            )

            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            ctx.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("EINSTALL", e.message, e)
        }
    }
}
