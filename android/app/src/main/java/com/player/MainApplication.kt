package com.player

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import androidx.media3.common.util.UnstableApi
import com.brentvatne.exoplayer.AudioProcessorHooks
import com.brentvatne.exoplayer.RemoteControlHooks
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.player.equalizer.EqualizerPackage
import com.player.haptics.HapticsPackage
import com.player.equalizer.EqualizerProcessor

@UnstableApi
class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          add(ApkInstallerPackage())
          add(ProfilePhotoPickerPackage())
          add(EqualizerPackage())
          add(HapticsPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // Every player's audio sink runs through the shared equaliser.
    AudioProcessorHooks.processors = arrayOf(EqualizerProcessor.shared)
    // Next / Previous from the notification, lock screen or headphones go to the app's queue.
    RemoteControlHooks.onNext = Runnable { emitRemote("next") }
    RemoteControlHooks.onPrevious = Runnable { emitRemote("previous") }
    loadReactNative(this)
  }

  private fun emitRemote(action: String) {
    reactHost.currentReactContext
      ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      ?.emit("GroovixRemoteControl", action)
  }
}
