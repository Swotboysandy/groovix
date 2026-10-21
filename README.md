<div align="center">

# Groovix — Free Music Player & Streaming App for Android

**Stream millions of songs, follow synced lyrics, and listen together with friends — a fast, ad-free music app built with React Native.**

[![Platform](https://img.shields.io/badge/platform-Android-3DDC84?logo=android&logoColor=white)](https://github.com/Swotboysandy/groovix_release/releases)
[![React Native](https://img.shields.io/badge/React%20Native-0.84-61DAFB?logo=react&logoColor=black)](https://reactnative.dev)
[![License: GPL v3](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/Swotboysandy/groovix_release?label=download)](https://github.com/Swotboysandy/groovix_release/releases/latest)

[Download APK](https://github.com/Swotboysandy/groovix_release/releases/latest) · [Website](https://groovix.pracandy.com) · [Privacy](https://groovix.pracandy.com/privacy) · [Terms](https://groovix.pracandy.com/terms)

</div>

---

## What is Groovix?

Groovix is an open-source **music streaming player for Android**. Search any song, album or artist, play it in up to **Hi-Res 24-bit FLAC**, read **time-synced lyrics** as the track plays, and keep the music going with an **endless AutoPlay radio** tuned to what you like. Sign in with Google to bring your **YouTube playlists, likes and subscriptions** into the app, or start a **Listen Together** session so friends hear the same song at the same moment.

No ads. No account required. Your listening history stays on your phone.

## Features

### 🎵 Streaming & playback
- **Hi-Res lossless FLAC streaming** — up to **24-bit / 192 kHz FLAC**, the highest quality available for each song, with automatic fallback when a track isn't offered in Hi-Res.
- **Four quality levels**, set separately for **Wi-Fi and mobile data**:

  | Quality | Format |
  |---|---|
  | Hi-Res | 24-bit FLAC, up to 192 kHz |
  | CD Lossless | 16-bit / 44.1 kHz FLAC |
  | High | 320 kbps AAC |
  | Data saver | 96 kbps AAC |
- **Live format label** — the player shows what is actually playing (24-bit FLAC, FLAC, AAC), and *Stats for nerds* shows the bit depth and sample rate.
- **Configurable sources** — pick which audio sources are used and in what order.
- **Built-in equalizer** — Dynamic tone pad or a 7-band manual EQ, plus left/right balance.
- **Offline downloads** with their own quality setting and a Wi-Fi-only option.
- **Background playback** with lock-screen and notification controls.

### 📝 Synced lyrics
- Line-by-line and **word-by-word synced lyrics** from many lyric providers, raced in parallel so the best match wins.
- **Lyrics translation** into 20 languages, shown under each line.
- Tap any line to jump to that moment in the song.

### 🔎 Discovery & recommendations
- A personalised **home feed** — Quick picks, new albums & singles, trending music and more.
- **Explore moods & genres** — Chill, Workout, Focus, Romance and dozens of curated playlists.
- **Search suggestions as you type**, with filters for songs, albums, artists and playlists.
- **Endless AutoPlay radio** that builds a varied station from the song you're playing.

### 👥 Social & personal
- **Listen Together** — share a code and play the same music, in sync, with friends.
- **Replay** — your top songs, artists and albums by week, month, year or all time.
- **Google sign-in** to import YouTube playlists, liked videos and subscriptions.
- **ListenBrainz scrobbling** to keep a public record of what you play.
- **Backup & restore** — export all settings and history to one JSON file.

### 🎨 Design
- A clean, modern interface with a glass tab bar, full-bleed artwork and smooth, spring-based animations.
- Light, dark or system theme, haptic feedback, and options to reduce motion and blur.

## Download

Grab the latest APK from the **[Releases page](https://github.com/Swotboysandy/groovix_release/releases/latest)** and install it on any Android phone (Android 7.0+). Groovix updates itself in-app when a new release is published.

## Build from source

**Requirements:** Node.js 20+, JDK 17, Android SDK (NDK 27.1), an Android device or emulator.

Copy `src/config/private.example.ts` to `src/config/private.ts` before building. Left empty, the app runs without the optional proxy, invite gate and Listen Together backend; fill it in with your own servers to enable them.

```bash
git clone https://github.com/Swotboysandy/groovix.git
cd groovix
npm install          # also applies patches via patch-package
npm start            # Metro bundler
npm run android      # build and install the debug app
```

Release APK:

```bash
cd android && ./gradlew assembleRelease
```

## Tech stack

| Area | Technology |
|---|---|
| App | React Native 0.84, TypeScript |
| Navigation | React Navigation (bottom tabs + native stacks) |
| Animation | Reanimated, Gesture Handler |
| Playback | react-native-video (ExoPlayer / Media3) with a native audio processor for the equalizer |
| Native modules | Kotlin — equalizer, haptics, APK updater |
| Sign-in | Google Sign-In + YouTube Data API v3 (read-only) |

## Privacy

Groovix stores your preferences, history and downloads **only on your device**. Google sign-in is optional and uses read-only YouTube access to show your own playlists and likes. Read the full [privacy policy](https://groovix.pracandy.com/privacy).

## Contributing

**Contributions and bug reports are open to everyone.**

- **Found a bug?** [Open an issue](https://github.com/Swotboysandy/groovix/issues/new) with the steps to reproduce it, your phone model, Android version and Groovix version.
- **Have a fix or a feature?** Fork the repo, make your change on a branch and open a pull request. I review every pull request and merge the ones that fit.
- For larger changes, open an issue first so we can talk about the approach.

## License

Groovix is free software released under the [GNU General Public License v3.0](LICENSE). You can use, study, share and change it; anything you distribute that's based on it must stay open source under the same license.

## Disclaimer

Groovix is a player client. Music, artwork and lyrics belong to their respective owners and are provided by third-party services. Use the app in line with the laws and terms that apply to you.

---

<div align="center">

**Groovix** — free music streaming, synced lyrics and Listen Together for Android.

<sub>Keywords: free music app android, music player, music streaming app, synced lyrics app, lossless music player, FLAC music player, hi-res audio streaming, 24-bit FLAC, FLAC streaming app, lossless audio android, hi-res music player android, high quality music streaming, 192 kHz audio, CD quality music, 320 kbps music app, audiophile music player, listen together, react native music player, ad-free music app, open source music player</sub>

</div>
