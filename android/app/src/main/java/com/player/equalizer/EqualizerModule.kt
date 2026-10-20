package com.player.equalizer

import android.content.ActivityNotFoundException
import android.content.Intent
import android.media.audiofx.AudioEffect
import androidx.media3.common.util.UnstableApi
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.uimanager.ViewManager

/** JS bridge for the shared [EqualizerProcessor]: the screen sends a whole tuning at a time. */
@UnstableApi
class EqualizerModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "GroovixEqualizer"

    @ReactMethod
    fun setTuning(
        enabled: Boolean,
        manual: Boolean,
        bands: ReadableArray,
        toneX: Int,
        toneY: Int,
        focused: Boolean,
        balance: Double,
    ) {
        val curve = if (manual) {
            manualCurve((0 until bands.size()).map { bands.getDouble(it).toFloat() })
        } else {
            toneCurve(toneX, toneY, focused)
        }
        EqualizerProcessor.shared.setTuning(enabled, curve, balance.toFloat())
    }

    /** "System equalizer" row: the device's own effects panel. */
    @ReactMethod
    fun openSystemEqualizer() {
        val intent = Intent(AudioEffect.ACTION_DISPLAY_AUDIO_EFFECT_CONTROL_PANEL).apply {
            putExtra(AudioEffect.EXTRA_PACKAGE_NAME, reactApplicationContext.packageName)
            putExtra(AudioEffect.EXTRA_CONTENT_TYPE, AudioEffect.CONTENT_TYPE_MUSIC)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            reactApplicationContext.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
        }
    }
}

@UnstableApi
class EqualizerPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(EqualizerModule(reactContext))

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
