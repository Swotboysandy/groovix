package com.player

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    convertSharedPlaylistToDeepLink(intent)
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      val fastestMode = windowManager.defaultDisplay.supportedModes.maxByOrNull { it.refreshRate }
      if (fastestMode != null && fastestMode.refreshRate > 60f) {
        val attributes = window.attributes
        attributes.preferredDisplayModeId = fastestMode.modeId
        window.attributes = attributes
      }
    }
  }

  override fun onNewIntent(intent: Intent) {
    convertSharedPlaylistToDeepLink(intent)
    super.onNewIntent(intent)
  }

  /** Turns a URL shared from WhatsApp or another app into the same route used by Groovix links. */
  private fun convertSharedPlaylistToDeepLink(incoming: Intent) {
    if (incoming.action != Intent.ACTION_SEND || incoming.type != "text/plain") return
    val sharedText = incoming.getStringExtra(Intent.EXTRA_TEXT) ?: return
    val url = Regex("https?://[^\\s]+", RegexOption.IGNORE_CASE)
      .find(sharedText)?.value?.trimEnd('.', ',', ')', ']', '}', '>', '"', '\'') ?: return
    val supported = Regex("(spotify\\.com|youtube\\.com|youtu\\.be|music\\.apple\\.com|tidal\\.com)", RegexOption.IGNORE_CASE)
      .containsMatchIn(url)
    if (!supported) return
    incoming.action = Intent.ACTION_VIEW
    incoming.data = Uri.Builder()
      .scheme("groovix")
      .authority("playlist-import")
      .appendQueryParameter("importUrl", url)
      .build()
    incoming.removeExtra(Intent.EXTRA_TEXT)
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "player"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
