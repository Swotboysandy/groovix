package com.player

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
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

    /** Posts "Update available" to the notification shade; tapping it opens Groovix. */
    @ReactMethod
    fun notifyUpdate(version: String, notes: String) {
        val context = reactApplicationContext.applicationContext
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = context.getSystemService(NotificationManager::class.java)
            if (manager?.getNotificationChannel(UPDATE_CHANNEL) == null) {
                manager?.createNotificationChannel(
                    NotificationChannel(UPDATE_CHANNEL, "App updates", NotificationManager.IMPORTANCE_DEFAULT).apply {
                        description = "Tells you when a new version of Groovix is ready"
                    }
                )
            }
        }
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        } ?: return
        val tap = PendingIntent.getActivity(context, 4242, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, UPDATE_CHANNEL)
            .setSmallIcon(context.applicationInfo.icon)
            .setContentTitle("Groovix $version is available")
            .setContentText(notes.ifBlank { "Tap to update to the latest version." })
            .setStyle(NotificationCompat.BigTextStyle().bigText(notes.ifBlank { "Tap to update to the latest version." }))
            .setContentIntent(tap)
            .setAutoCancel(true)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(UPDATE_NOTIFICATION_ID, notification) }
    }

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

    companion object {
        private const val UPDATE_CHANNEL = "groovix_updates"
        private const val UPDATE_NOTIFICATION_ID = 4242
    }
}
