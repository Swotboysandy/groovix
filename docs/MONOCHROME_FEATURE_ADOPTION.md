# Monochrome feature and settings adoption plan

Source audited: `monochrome-music/monochrome`, `main`, on 2026-08-25.

This is an implementation inventory, not a request to copy Monochrome's branding or web UI. Groovix should adapt useful behavior to React Native and Android, preserve its own design, use only endpoints we can legally and reliably call, and never copy private tokens or deployment credentials.

Status legend:

- **Present** — Groovix already has the core behavior.
- **Partial** — useful behavior exists but does not cover Monochrome's full surface.
- **Add** — suitable for Groovix.
- **Adapt** — web behavior needs a native Android equivalent.
- **Defer** — expensive, risky, account-dependent, or needs a separate product decision.
- **Web-only** — should not be copied literally into the Android app.

## Complete settings inventory

### Appearance

| Monochrome setting | Groovix status | Groovix direction |
| --- | --- | --- |
| System/black/white/dark/ocean/purple/forest/mocha/macchiato/frappe/latte/custom themes | Partial | Keep Groovix palettes; add system-following mode and more accessible palettes later. |
| Community theme store, custom CSS theme, theme import/export | Defer | Native token packs could be supported later; never execute arbitrary CSS/JS. |
| Font presets, Google font, URL font, uploaded font | Adapt | Offer bundled native fonts and size controls; remote/uploaded fonts need security and licensing review. |
| Font size 50-200% | Add | Respect Android font scale first, then optional in-app multiplier. |
| Waveform seek bar | Partial | Existing sliders work; add cached waveform generation in the player phase. |
| Blurred album-cover backgrounds | Present | Retain and verify in both themes. |
| Dynamic accent color from artwork | Add | Extract a restrained accent off the JS thread and preserve contrast. |
| Square fullscreen cover | Add | Simple player preference. |
| 3D cover tilt, distance, speed | Add | Reanimated-only and disabled with reduced-motion. |
| Fullscreen visualizer on/off | Add | Native-safe visualizer phase. |
| Visualizer styles: LCD pixels, particles, Unknown Pleasures, Butterchurn, Kawarp | Adapt | Implement lightweight native presets; browser WebGL presets are not copied directly. |
| Visualizer solid/blended mode | Add | Use album blur as optional backdrop. |
| Smart intensity, sensitivity, brightness | Add | Clamp values and include photosensitivity warning. |
| Preset selection, auto-cycle, duration, random order | Add | Persist per user. |
| Spinning CD cover | Add | Optional and reduced-motion aware. |
| Home sections: songs, albums, artists, jump back in, editor picks | Partial | Groovix has song-heavy discovery; albums/artists and section visibility remain. |
| Shuffle editor picks and choose source | Adapt | Use Groovix editorial/chart sources, not Monochrome data files. |
| Compact artist and album cards | Add | Useful density preference for small phones/tablets. |
| Artist video banners | Defer | Needs a legal video source and data/battery controls. |

### Interface

| Monochrome setting | Groovix status | Groovix direction |
| --- | --- | --- |
| Show/hide/reorder Home, Library, Recent, Unreleased, Donate, Settings, About, Discord, Parties, GitHub | Adapt | Bottom navigation stays stable; allow optional secondary-page ordering only. |
| Close drawers/modals on navigation | Present | Continue using navigation-aware native drawers. |
| Back button closes drawer before navigating | Partial | Audit every draggable sheet with Android BackHandler. |
| Album-art tap destination: album/fullscreen/lyrics | Add | Native player preference. |
| Fullscreen cover action: exit, hide UI, play/pause, next, previous, none | Add | Expose safe tap-action options. |
| Keyboard shortcuts and editable command palette | Web-only/Adapt | Do not prioritize on phones; map media keys and add tablet/keyboard support later. |

### Scrobbling

| Monochrome setting | Groovix status | Groovix direction |
| --- | --- | --- |
| Scrobble threshold | Add | Persist percentage and submit only after threshold. |
| Last.fm OAuth or credentials, enable, love-on-like, custom API credentials | Defer | OAuth first; secrets must use Android Keystore, never AsyncStorage. |
| Libre.fm connect, enable, love-on-like | Defer | Add through the same scrobbler interface. |
| ListenBrainz token, custom URL, love-on-like | Defer | Keystore-backed token and validated HTTPS endpoint. |
| Maloja API key and custom server | Defer | Keystore-backed credentials; local HTTP only behind explicit developer mode. |

### Audio

| Monochrome setting | Groovix status | Groovix direction |
| --- | --- | --- |
| Auto, Hi-Res 24-bit, Lossless 16-bit, AAC 320, AAC 96 streaming | Partial → Phase 1 | Four verified tiers now persist; automatic network adaptation remains. |
| Quality badges | Present | Already shows verified codec/rate/bit depth/bitrate; add visibility toggle later. |
| Original album year | Add | Needs reliable release metadata. |
| Gapless playback | Partial | DASH seeking works; real dual-buffer gapless needs a native playback engine/queue. |
| ReplayGain off/track/album and preamp | Add | Parse gain metadata and apply native gain without clipping. |
| Mono audio | Add | Native audio processor or supported player channel configuration. |
| Exponential volume curve | Add | Low-risk mapping in player controls. |
| Playback speed 0.01-100x and preserve pitch | Adapt | Use Android-supported safe range; extreme browser values are not appropriate. |
| Binaural/spatial DSP, auto spatial detection, crossfeed level, HRTF preset, stereo width | Defer | Requires a tested native DSP chain and device profiling. |
| Legacy graphic EQ, 3-32 bands, range, presets, preamp, custom presets, APO import/export | Defer | Start with Android equalizer session support; advanced DSP requires native work. |
| Parametric EQ with peaking/shelves, Q, graph editing, Mid/Side, import/export | Defer | Dedicated native DSP phase. |
| AutoEQ headphone database, target curves, filter count/range/sample rate, profiles, preamp compensation | Defer | Large feature; cache licensed profiles and process natively. |
| Speaker EQ/room correction, 2.0/5.1/7.1, microphone measurement, per-channel profiles | Defer | Requires permission UX, calibration, multichannel output, and extensive hardware QA. |

### Downloads

| Monochrome setting | Groovix status | Groovix direction |
| --- | --- | --- |
| Independent Hi-Res/Lossless/AAC 320/AAC 96 download quality | Phase 1 | Implemented as a persistent preference, separate from streaming. |
| Lossless container conversion | Defer | Keep source container until a native, lossless remuxer is justified. |
| ZIP/folder/local-media/individual bulk methods | Adapt | Android Storage Access Framework replaces browser folder picker/ZIP behavior. |
| Remember folder, reset folder, save singles to folder | Adapt | Persist a scoped Android document-tree URI, not a raw unrestricted path. |
| Force ZIP blob | Web-only | Browser memory workaround is not applicable. |
| Separate artists in metadata | Add | Extend metadata writer when multi-artist data is reliable. |
| Download LRC lyrics and Romaji lyrics | Partial | LRC is already saved; Romaji conversion remains. |
| Cover-art size | Add | Offer sensible cached/download sizes. |
| Filename and folder templates | Adapt | Sanitize reserved Android filename characters and prevent path traversal. |
| M3U, M3U8, CUE, NFO, JSON sidecars | Add | Useful for exported albums; validate encoding and relative paths. |
| Relative paths, separate discs, cover.jpg | Add | Apply only to exported album folders. |
| Automatic metadata embedding | Partial | Current metadata sidecars exist; embedded tags need native tag-writing validation. |

### Instances and sources

| Monochrome setting | Groovix status | Groovix direction |
| --- | --- | --- |
| Developer-mode custom Tidal HiFi API URL | Defer | Only after URL validation, clear warning, timeout, and reset control. |
| Custom database/auth | Defer | Separate account/sync project; no production credentials in the app. |
| Unified/Amazon source, endpoint, Turnstile site key/bypass token | Do not copy | Credentials and bypass tokens are deployment-specific and unsafe to ship. |
| Deezer fallback endpoint | Defer | Add only if a stable, permitted credential-free contract is verified. |
| Multiple API instances, priority, refresh, failover | Add | Use health checks, cooldowns, per-capability routing, and truthful source labels. |
| Local files | Add | Android MediaStore/Storage Access Framework with explicit permission. |

### System, privacy, and data

| Monochrome setting | Groovix status | Groovix direction |
| --- | --- | --- |
| API response cache and clear cache | Partial | Add bounded cache metadata and user-visible clear control. |
| Automatic app update | Present | Existing updater remains; add channel and Wi-Fi-only controls later. |
| Anonymous analytics | Missing | Consent-first only; off until a privacy policy and data map exist. |
| Reset local data | Partial | Profile reset exists; split preferences/cache/library/download options. |
| Clear cloud data | Defer | Only after accounts/cloud sync exist, with reauthentication. |
| Backup/restore library and history JSON | Add | SAF export/import with schema version and validation. |
| Export/import all settings | Add | Versioned JSON; exclude tokens and device-specific paths. |
| Blocked artists, albums, and tracks | Add | Apply consistently to home, radio, search suggestions, and queue generation. |
| Server disruption banner | Adapt | Show compact source-health state only when playback/search is affected. |
| Modal interception preferences | Partial | Native back handling audit remains. |

## Complete product-feature inventory beyond Settings

### Discovery and catalog

- Personalized song, album, and artist recommendations; recently played/jump-back-in.
- Infinite recommendation radio and smart autoplay.
- Hot & New discovery with overall and genre filters.
- Editor's Picks and Album of the Year discovery.
- Search across tracks, albums, artists, playlists, and podcasts, including search history.
- Track, album, artist, playlist, and mix detail pages with related songs/albums/artists.
- Artist biographies, social links, popular tracks, albums, EPs/singles, and unreleased music.
- Music videos, animated album artwork, and ArtistGrid unreleased content.

Groovix already has personalized song discovery, chart/language feeds, radio, search categories, album/track pages, queues, and listening history. Album/artist recommendations, Hot & New, richer artist metadata, podcasts, video, and unreleased catalogs remain phased work.

### Library and organization

- Favorite tracks, albums, artists, playlists, and mixes.
- Personal playlists, playlist folders, covers, descriptions, and public/private sharing.
- Local file library.
- Recently played history.
- Import from YouTube Music URL/CSV, JSPF, XSPF, XML, and M3U, with strict album matching.
- Playlist sorting, searching, bulk actions, and public community playlists.

Groovix has liked-track learning, downloads, history, and queues. A first-class library database, albums/artists favorites, playlists/folders, import/export, and sharing are not complete.

### Playback and lyrics

- Queue editing, direct queue selection, shuffle, repeat, volume, seek, previous/next.
- Sleep timer.
- Synced lyrics, fullscreen lyrics, karaoke/word timing, Genius fallback, and Romaji.
- Media Session/system controls and background playback.
- Waveform seek, fullscreen player, visualizers, animated covers, and video playback.
- Gapless playback, ReplayGain, speed/pitch, mono, crossfeed/spatial DSP, and advanced EQ.

Groovix already has the core transport, editable Up Next, repeat/shuffle, background Android media controls, synced lyrics, draggable lyric/queue sheets, verified quality labels, and offline playback. Sleep timer, waveform, karaoke words, visualizers, and advanced DSP remain.

### Downloads and offline

- Single, album, playlist, artist/discography, and bulk downloads.
- Hi-Res/lossless/lossy quality selection, metadata embedding, artwork, lyrics, and export sidecars.
- Offline-capable PWA and local-media folder integration.

Groovix currently supports single-track offline packages and downloaded-song playback. Album/playlist bulk downloads, robust metadata embedding, Android export folders, resumable jobs, storage limits, and cleanup controls remain.

### Accounts, social, and integrations

- Account login and cross-device sync; Google, Discord, GitHub, Spotify, and email OAuth/auth.
- Public customizable profiles with privacy controls, websites, avatars, banners, and favorite albums.
- Public playlists and dynamic Discord embeds.
- Real-time listening parties with participants, chat, requests, and synchronized playback.
- Last.fm, Libre.fm, ListenBrainz, and Maloja scrobbling.
- Podcasts and organization.

Groovix Jam covers shared listening basics. Account sync, public identity/playlists, chat, OAuth, scrobbling, and podcasts require separate privacy/security work.

### Power-user, platform, and operations

- Command palette, keyboard/media shortcuts, configurable shortcuts, fullscreen controls.
- PWA install/offline cache, update handling, API caching, Sentry, anonymous analytics.
- Multi-instance health/failover, developer endpoint, custom auth/database, Docker/self-hosting.
- Theme store/editor, font customization, settings search, settings backup/import.
- Content blocking and local/cloud data reset.
- Haptic feedback and native media-session support through Capacitor.

For Groovix, media keys, haptics, native update flow, source failover, diagnostics, backups, and settings search are relevant. Docker/PWA controls and browser-specific filesystem/blob workarounds are not copied literally.

## Delivery phases

### Phase 1 — Reliable preferences and truthful quality (started)

- Persistent default streaming quality.
- Persistent independent download quality.
- Existing per-track fallback remains truthful: the UI reports the resolved codec/tier.
- Preferences merge safely so theme/language edits do not erase audio settings.
- Download entry points use the download preference.

Next Phase 1 items: network-aware Auto quality, quality-badge visibility, explicit-content filter, cache controls, Android-back behavior audit, and focused tests.

### Phase 2 — Library and discovery

- Favorite albums/artists and durable playlists/folders.
- Hot & New, recommended albums/artists, jump-back-in, and configurable home sections.
- Blocked-content filtering across recommendations/search/queue.
- Search history/suggestions and richer artist/album/track related content.
- Android local-file library.

### Phase 3 — Player and offline depth

- Sleep timer, waveform seek, lyrics word/karaoke mode, Romaji option.
- Album/playlist downloads with resumable background jobs and storage controls.
- Metadata embedding and safe Android folder export with optional sidecars.
- Gapless playback investigation, ReplayGain, mono, exponential volume, and safe playback speed.

### Phase 4 — Visual and accessibility polish

- System theme, additional accessible palettes, dynamic artwork accent, font scaling.
- Reduced-motion support, optional cover tilt/CD mode, lightweight visualizers, photosensitivity guard.
- TalkBack, 48dp targets, contrast, large text, tablet/foldable layouts, and native-FPS profiling.

### Phase 5 — Accounts, sync, and social

- Secure account architecture and cross-device sync.
- Public/private profiles and playlists.
- Jam upgrades: presence, chat, requests, moderation, reconnection, and sync telemetry.
- OAuth scrobblers with Android Keystore-backed tokens.

### Phase 6 — Source resilience and release hardening

- Capability-aware API instance health, cooldown, failover, and diagnostics.
- Versioned settings/library backup and restore.
- Consent-first analytics/crash reporting, offline/error states, E2E device tests.
- Staged release with rollback and source-health monitoring.

## Guardrails

- Never display FLAC/Hi-Res unless the returned manifest or local file proves it.
- Never ship Monochrome deployment tokens, Turnstile bypass values, private endpoints, or account credentials.
- Never add a toggle that has no working behavior.
- Keep advanced DSP disabled until it is measured on real Android hardware.
- Use Android Keystore for secrets and SAF/MediaStore for user-selected files.
- Preserve Groovix branding, theme, navigation, and existing working playback behavior.
