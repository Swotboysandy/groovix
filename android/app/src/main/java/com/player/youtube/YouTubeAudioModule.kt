package com.player.youtube

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request
import org.schabi.newpipe.extractor.downloader.Response
import org.schabi.newpipe.extractor.stream.StreamInfo
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * YouTube audio on the phone itself, the way BitChord does it: NewPipe
 * Extractor asks YouTube from this device's own connection (a home or mobile
 * IP YouTube trusts), so no server or account is needed. The last fallback
 * after the lossless server and JioSaavn.
 */
class YouTubeAudioModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "YouTubeAudio"

    private val worker = Executors.newSingleThreadExecutor()

    @ReactMethod
    fun resolve(videoId: String, promise: Promise) {
        worker.execute {
            try {
                ensureInit()
                val info = StreamInfo.getInfo(ServiceList.YouTube, "https://www.youtube.com/watch?v=$videoId")
                // ExoPlayer plays both; prefer M4A/AAC, then the highest bitrate.
                val audio = info.audioStreams
                    .filter { !it.content.isNullOrEmpty() && it.isUrl }
                    .sortedWith(compareByDescending<org.schabi.newpipe.extractor.stream.AudioStream> { it.format?.name == "M4A" }
                        .thenByDescending { it.averageBitrate })
                    .firstOrNull()
                if (audio == null) { promise.reject("NO_AUDIO", "No audio stream for $videoId"); return@execute }
                val map = Arguments.createMap()
                map.putString("url", audio.content)
                map.putString("codec", audio.format?.name ?: "")
                map.putInt("bitrate", audio.averageBitrate)
                map.putDouble("duration", info.duration.toDouble())
                promise.resolve(map)
            } catch (e: Exception) {
                promise.reject("YOUTUBE_FAILED", e.message ?: e.javaClass.simpleName)
            }
        }
    }

    companion object {
        @Volatile private var initialised = false
        @Synchronized private fun ensureInit() {
            if (!initialised) { NewPipe.init(OkHttpDownloader()); initialised = true }
        }
    }
}

/** NewPipe's network calls through OkHttp (already in the app via React Native). */
private class OkHttpDownloader : Downloader() {
    private val client = OkHttpClient.Builder().readTimeout(30, TimeUnit.SECONDS).build()

    override fun execute(request: Request): Response {
        val body = request.dataToSend()?.toRequestBody()
        val builder = okhttp3.Request.Builder().url(request.url()).method(request.httpMethod(), body)
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0")
        request.headers().forEach { (name, values) ->
            builder.removeHeader(name)
            values.forEach { builder.addHeader(name, it) }
        }
        client.newCall(builder.build()).execute().use { res ->
            return Response(res.code, res.message, res.headers.toMultimap(), res.body?.string(), res.request.url.toString())
        }
    }
}
