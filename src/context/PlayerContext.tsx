import NetInfo from '@react-native-community/netinfo';
import { appSettings, loadAppSettings, subscribeAppSettings } from '../store/appSettings';
import { scrobbleIfHeard, sendNowPlaying } from '../services/listenbrainz';
import React, { createContext, useContext, useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import Video, { VideoRef } from 'react-native-video';
import RNFS from 'react-native-fs';
import { API, getTidalProxyDashManifest, StreamData } from '../api';
import { getPrefs, savePrefs } from '../store/preferences';
import type { Track, VerifiedFormat } from '../types';
import { recordPlayedTrack } from '../store/listeningProfile';
import { recordListening } from '../store/playHistory';
import { getRadioRecommendations } from '../services/recommendations';
import { appendRadioTracks } from '../services/musicMatching';

export type StreamQuality = 'HI_RES_LOSSLESS' | 'LOSSLESS' | 'HIGH' | 'LOW';

// Formats the REAL, ffprobe-verified format of what's actually playing into a short label
// (e.g. "FLAC 16-bit/44.1kHz", "MP3 44.1kHz"). Returns null when the format isn't known
// yet - callers must show a neutral placeholder in that case and never a *claimed* quality,
// so the badge only ever states what we've actually verified is playing.
export function formatVerifiedQuality(vf: VerifiedFormat | null): string | null {
    if (!vf || !vf.codec) return null;
    const codec = vf.codec.toUpperCase();
    const khz = vf.sampleRate ? `${vf.sampleRate / 1000}kHz` : '';
    const lossless = codec === 'FLAC' || codec === 'ALAC' || codec === 'WAV' || codec === 'AIFF';
    if (lossless) {
        // Bit depth is meaningful for lossless — show it when ffprobe reported it.
        const bits = vf.bitDepth ? `${vf.bitDepth}-bit` : '';
        const specs = [bits, khz].filter(Boolean).join('/');
        return specs ? `${codec} ${specs}` : codec;
    }
    // Lossy (MP3/AAC): bit depth is meaningless, don't fabricate it.
    const nominalKbps = vf.bitrate ? Math.max(32, Math.round(vf.bitrate / 32000) * 32) : null;
    const bitrate = nominalKbps ? `${nominalKbps}kbps` : '';
    const specs = [bitrate, khz].filter(Boolean).join('/');
    return specs ? `${codec} ${specs}` : codec;
}

interface PlayerContextType {
    currentTrack: Track | null;
    isPlaying: boolean;
    isBuffering: boolean;
    currentTime: number;
    duration: number;
    volume: number;
    quality: StreamQuality;
    playTrack: (track: Track, startAt?: number) => void;
    playPlaylist: (tracks: Track[], startIndex?: number) => void;
    togglePlayPause: () => void;
    seek: (time: number) => void;
    setVolume: (vol: number) => void;
    setQuality: (q: StreamQuality) => void;
    // Skip to the next track. With no arg: advances through the queue → auto-recommendations.
    // With a track: jumps straight to it (and remembers the current one in history).
    playNext: (track?: Track) => void;
    // Go back to the previously played track (from history); restarts current if none.
    playPrevious: () => void;
    // User-managed "up next" queue. These play (in order) before auto-recommendations.
    queue: Track[];
    // Actual playback order shown to the user: explicit queue first, then radio picks.
    upNext: Track[];
    /** Tracks already played this session, newest first. */
    history: Track[];
    // Starts an item from the displayed Up Next list and preserves everything after it.
    playFromUpNext: (index: number) => void;
    addToQueue: (track: Track) => void;
    removeFromQueue: (index: number) => void;
    /** Reorders the explicit queue (drag-to-reorder). */
    moveInQueue: (from: number, to: number) => void;
    /** Puts a track at the front of the explicit queue ("Play next"). */
    playNextInQueue: (track: Track) => void;
    clearQueue: () => void;
    // Repeat: 'off' → advance normally, 'one' → replay current, 'all' → same as off but
    // the auto-recommender keeps it going forever (never stops).
    repeatMode: 'off' | 'one' | 'all';
    cycleRepeat: () => void;
    // Shuffle only affects how the auto-recommendation pool is ordered; the explicit user
    // queue always plays in the order it was added.
    shuffle: boolean;
    toggleShuffle: () => void;
    // Real, ffprobe-verified format of the currently playing lucida stream (null for other sources).
    verifiedFormat: VerifiedFormat | null;
    // Live status of an in-progress lucida rip+download (null once done/for other sources).
    lucidaProgress: { bytesWritten: number; totalBytes: number | null; startedAt: number } | null;
    // True when we gave up waiting on lucida (stuck at 0 bytes past the timeout) and fell
    // back to playing the same track from the original Tidal/Audiomack source instead.
    usingFallback: boolean;
    // When set, this overrides the default "autoplay a similar song" behaviour at
    // track end. Returning true means "handled" (skip personal autoplay). The jam
    // uses this so the room advances through the shared queue instead of a playlist.
    setOnTrackEnd: (fn: (() => boolean) | null) => void;
}

const PlayerContext = createContext<PlayerContextType>({
    currentTrack: null,
    isPlaying: false,
    isBuffering: false,
    currentTime: 0,
    duration: 0,
    volume: 0.7,
    quality: 'LOSSLESS',
    playTrack: () => { },
    playPlaylist: () => { },
    togglePlayPause: () => { },
    seek: () => { },
    setVolume: () => { },
    setQuality: () => { },
    playNext: () => { },
    playPrevious: () => { },
    queue: [],
    upNext: [],
    history: [],
    playFromUpNext: () => { },
    addToQueue: () => { },
    removeFromQueue: () => { },
    moveInQueue: () => { },
    playNextInQueue: () => { },
    clearQueue: () => { },
    repeatMode: 'off',
    cycleRepeat: () => { },
    shuffle: false,
    toggleShuffle: () => { },
    setOnTrackEnd: () => { },
    verifiedFormat: null,
    lucidaProgress: null,
    usingFallback: false,
});

export const usePlayer = () => useContext(PlayerContext);

type PlayerSummaryContextType = Pick<PlayerContextType, 'currentTrack' | 'isPlaying' | 'playTrack' | 'playFromUpNext' | 'addToQueue' | 'upNext'>;

const PlayerSummaryContext = createContext<PlayerSummaryContextType>({
    currentTrack: null,
    isPlaying: false,
    playTrack: () => { },
    playFromUpNext: () => { },
    addToQueue: () => { },
    upNext: [],
});

// Screens that do not display live progress use this narrower context. This prevents
// large lists such as Home from re-rendering every time the audio clock advances.
export const usePlayerSummary = () => useContext(PlayerSummaryContext);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
    const videoRef = useRef<VideoRef>(null);
    const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isBuffering, setIsBuffering] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolumeState] = useState(0.7);
    const [quality, setQualityState] = useState<StreamQuality>('LOSSLESS');
    const [streamUrl, setStreamUrl] = useState<string | null>(null);
    const [notificationArtworkUri, setNotificationArtworkUri] = useState<string | undefined>(undefined);
    const [verifiedFormat, setVerifiedFormat] = useState<VerifiedFormat | null>(null);
    const [lucidaProgress, setLucidaProgress] = useState<{ bytesWritten: number; totalBytes: number | null; startedAt: number } | null>(null);
    const [usingFallback, setUsingFallback] = useState(false);
    const [queue, setQueue] = useState<Track[]>([]);
    const [upNext, setUpNext] = useState<Track[]>([]);
    const [history, setHistory] = useState<Track[]>([]);
    // Every song played or suggested this session, for "Don't repeat songs".
    const sessionSeenRef = useRef<Set<number>>(new Set());
    const [repeatMode, setRepeatMode] = useState<'off' | 'one' | 'all'>('off');
    const [shuffle, setShuffle] = useState(false);

    const currentTimeRef = useRef(0);
    const pendingSeekRef = useRef<number | null>(null);
    const seekInFlightRef = useRef(false);
    const seekGuardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const streamRequestIdRef = useRef(0);
    // The preference and the confirmed quality of this track are separate. A
    // per-track fallback must not silently downgrade the next track as well.
    const qualityRef = useRef<StreamQuality>('LOSSLESS');
    const resolvedQualityRef = useRef<StreamQuality>('LOSSLESS');
    // Keep the user's requested transport state separate from ExoPlayer's transient
    // callbacks. Replacing a stream briefly reports "paused" while the new source loads;
    // that must not undo a play tap or leave a quality switch paused.
    const desiredPlayingRef = useRef(false);
    const streamReloadingRef = useRef(false);
    const streamReloadGuardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastTransportIntentAtRef = useRef(0);
    const onTrackEndRef = useRef<(() => boolean) | null>(null);
    const lucidaPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const lucidaFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lucidaBytesRef = useRef(0);
    const currentTrackRef = useRef<Track | null>(null);
    const lucidaRetriesRef = useRef(0);
    const previewRecoveryAttemptedRef = useRef(false);
    const directTidalDashUrlRef = useRef<string | null>(null);
    const tidalProxyAttemptedRef = useRef(false);
    // Queue + history live in refs (read inside async advance logic without stale closures);
    // the `queue` state above mirrors queueRef purely so the UI re-renders.
    const queueRef = useRef<Track[]>([]);
    const historyRef = useRef<Track[]>([]);            // stack of previously-played tracks
    const autoQueueRef = useRef<Track[]>([]);          // algorithm-generated recommendations
    const recentIdsRef = useRef<number[]>([]);         // last ~40 played ids, to avoid repeats
    const repeatModeRef = useRef<'off' | 'one' | 'all'>('off');
    const shuffleRef = useRef(false);
    const playSessionRef = useRef(0);
    const advancePendingRef = useRef(false);
    const radioRequestRef = useRef<{ session: number; promise: Promise<Track[]> } | null>(null);
    const fallbackRequestRef = useRef<number | null>(null);

    useEffect(() => {
        let active = true;
        getPrefs().then(prefs => {
            const saved = prefs?.streamingQuality;
            if (!active || !saved || currentTrackRef.current) return;
            qualityRef.current = saved;
            resolvedQualityRef.current = saved;
            setQualityState(saved);
        });
        return () => { active = false; };
    }, []);

    const setQualityRef = useRef<(q: StreamQuality) => void>(() => {});
    useEffect(() => {
        let onWifi = true;
        const apply = () => {
            const settings = appSettings();
            setQualityRef.current(onWifi ? settings.qualityWifi : settings.qualityMobile);
        };
        const unsubscribeNet = NetInfo.addEventListener(state => {
            const wifi = state.type !== 'cellular';
            if (wifi !== onWifi) { onWifi = wifi; apply(); }
        });
        NetInfo.fetch().then(state => { onWifi = state.type !== 'cellular'; return loadAppSettings(); }).then(apply).catch(() => {});
        const unsubscribeSettings = subscribeAppSettings(apply);
        return () => { unsubscribeNet(); unsubscribeSettings(); };
    }, []);

    const syncUpNext = useCallback(() => {
        setUpNext([...queueRef.current, ...autoQueueRef.current]);
    }, []);
    const syncQueue = useCallback((next: Track[]) => {
        queueRef.current = next;
        setQueue(next);
        setUpNext([...next, ...autoQueueRef.current]);
    }, []);
    const rememberPlayed = useCallback((t: Track) => {
        recentIdsRef.current = [t.id, ...recentIdsRef.current.filter(id => id !== t.id)].slice(0, 40);
    }, []);

    const stopLucidaPoll = useCallback(() => {
        if (lucidaPollRef.current) { clearInterval(lucidaPollRef.current); lucidaPollRef.current = null; }
        if (lucidaFallbackTimerRef.current) { clearTimeout(lucidaFallbackTimerRef.current); lucidaFallbackTimerRef.current = null; }
    }, []);

    const setOnTrackEnd = useCallback((fn: (() => boolean) | null) => {
        onTrackEndRef.current = fn;
    }, []);

    const resolveStream = async (data: StreamData, trackId: number): Promise<string> => {
        if (data.isDash && data.dashXml) {
            const mpdPath = `${RNFS.TemporaryDirectoryPath}/stream_${trackId}.mpd`;
            await RNFS.writeFile(mpdPath, data.dashXml, 'utf8');
            return `file://${mpdPath}`;
        }
        return data.url;
    };

    // Media3's notification bitmap loader is not reliable with every remote artwork
    // host used by our catalog providers. Cache the cover locally before mounting the
    // player so Android receives a stable file:// URI for lock-screen/media surfaces.
    const prepareNotificationArtwork = async (track: Track): Promise<string | undefined> => {
        const supplied = track.coverUrl || track.album?.cover;
        if (!supplied) return undefined;
        if (supplied.startsWith('file://')) return supplied;
        const remote = supplied.startsWith('http') ? supplied : API.getCoverUrl(supplied, 512);
        if (!remote) return undefined;

        const artworkPath = `${RNFS.CachesDirectoryPath}/groovix-media-${track.id}.jpg`;
        let timeout: ReturnType<typeof setTimeout> | null = null;
        try {
            if (await RNFS.exists(artworkPath)) return `file://${artworkPath}`;
            const download = RNFS.downloadFile({
                fromUrl: remote,
                toFile: artworkPath,
                headers: { 'User-Agent': 'Groovix/1.0' },
            });
            const result = await Promise.race([
                download.promise,
                new Promise<never>((_, reject) => {
                    timeout = setTimeout(() => {
                        RNFS.stopDownload(download.jobId);
                        reject(new Error('Artwork download timed out'));
                    }, 1800);
                }),
            ]);
            if (timeout) clearTimeout(timeout);
            if (result.statusCode >= 200 && result.statusCode < 300 && result.bytesWritten > 0) {
                return `file://${artworkPath}`;
            }
        } catch {
            // Remote artwork is still useful to Android when the local cache fails.
        } finally {
            if (timeout) clearTimeout(timeout);
        }
        return remote;
    };

    // Credential-free fallback for a temporarily unavailable primary source. It only
    // accepts a strong title + artist match, so a similar title cannot play the wrong song.
    const fallbackToDefaultSource = useCallback(async (track: Track, requestId = streamRequestIdRef.current) => {
        if (requestId !== streamRequestIdRef.current || fallbackRequestRef.current === requestId) return;
        fallbackRequestRef.current = requestId;
        pendingSeekRef.current = currentTimeRef.current > 0 ? currentTimeRef.current : null;
        stopLucidaPoll();
        setLucidaProgress(null);
        setUsingFallback(true);
        setStreamUrl(null);
        setVerifiedFormat(null);
        setIsBuffering(true);
        try {
            const data = await API.getFreeFallbackStream(track);
            if (requestId !== streamRequestIdRef.current) return;
            if (!data) throw new Error('No matching free fallback is available');
            const url = await resolveStream(data, track.id);
            if (requestId !== streamRequestIdRef.current) return;
            if (data.format) setVerifiedFormat({ ...data.format, channels: 2, bytes: 0 });
            if (data.resolvedQuality) {
                resolvedQualityRef.current = data.resolvedQuality;
                setQualityState(data.resolvedQuality);
            }
            setStreamUrl(url);
        } catch {
            if (requestId !== streamRequestIdRef.current) return;
            setIsBuffering(false);
            streamReloadingRef.current = false;
            if (streamReloadGuardTimerRef.current) clearTimeout(streamReloadGuardTimerRef.current);
            desiredPlayingRef.current = false;
            setIsPlaying(false);
        }
    }, [stopLucidaPoll]);

    const fetchStream = useCallback(async (track: Track, q: StreamQuality) => {
        const requestId = ++streamRequestIdRef.current;
        fallbackRequestRef.current = null;
        // Artwork must not hold downloaded/ready audio hostage for up to 1.8s.
        // Publish the stable local cover to the media session when it arrives.
        void prepareNotificationArtwork(track).then(artwork => {
            if (requestId === streamRequestIdRef.current) setNotificationArtworkUri(artwork);
        }).catch(() => undefined);
        try {
            currentTrackRef.current = track;
            lucidaRetriesRef.current = 0;
            seekInFlightRef.current = false;
            if (seekGuardTimerRef.current) clearTimeout(seekGuardTimerRef.current);
            if (streamReloadGuardTimerRef.current) clearTimeout(streamReloadGuardTimerRef.current);
            streamReloadingRef.current = true;
            setIsBuffering(true);
            setStreamUrl(null);
            setVerifiedFormat(null);
            stopLucidaPoll();
            setLucidaProgress(null);
            setUsingFallback(false);
            directTidalDashUrlRef.current = null;
            tidalProxyAttemptedRef.current = false;
            lucidaBytesRef.current = 0;
            if (track.localPath) {
                const local = track.localPath.startsWith('file://') ? track.localPath : `file://${track.localPath}`;
                setStreamUrl(local);
                setIsBuffering(false);
                return;
            }
            // Every track resolves through the Tidal manifest now. The old
            // route was a rip on our own VPS, which has been reporting
            // "downloading" at zero bytes and then 500ing — it only ever added a
            // wait before failing, so it is gone rather than kept as a fallback.
            const data = await API.getTrackStreamData(track, q);
            if (requestId !== streamRequestIdRef.current) return;
            if (/^https?:\/\/.*\.mpd(?:\?|$)/i.test(data.url)) {
                directTidalDashUrlRef.current = data.url;
            }
            const url = await resolveStream(data, track.id);
            if (requestId !== streamRequestIdRef.current) return;
            if (data.format) {
                setVerifiedFormat({ ...data.format, channels: 2, bytes: 0 });
            }
            if (track.source !== 'audius' && data.resolvedQuality) {
                resolvedQualityRef.current = data.resolvedQuality;
                setQualityState(data.resolvedQuality);
            }
            setStreamUrl(url);
        } catch (e: any) {
            if (requestId !== streamRequestIdRef.current) return;
            console.log('Stream error:', e);
            // API already tried every compatible tier, including LOSSLESS.
            // Do not replay that whole expensive provider chain a second time.
            if (track.source !== 'audius') {
                void fallbackToDefaultSource(track, requestId);
            } else {
                setIsBuffering(false);
                streamReloadingRef.current = false;
                desiredPlayingRef.current = false;
                setIsPlaying(false);
                if (streamReloadGuardTimerRef.current) clearTimeout(streamReloadGuardTimerRef.current);
            }
        }
    }, [fallbackToDefaultSource, stopLucidaPoll]);

    // Core "start playing this track". recordHistory=false when we're navigating *into*
    // history (previous button) or replaying (repeat-one), so we don't re-push and loop.
    const listenStartedAtRef = useRef(Date.now());
    const listenedMsRef = useRef(0);
    const lastProgressRef = useRef(0);

    const startTrack = useCallback((track: Track, startAt: number = 0, recordHistory: boolean = true) => {
        playSessionRef.current += 1;
        const outgoing = currentTrackRef.current;
        // Replay's log: what was actually heard of the outgoing track.
        if (outgoing) {
            recordListening(outgoing, listenStartedAtRef.current, listenedMsRef.current).catch(() => undefined);
            scrobbleIfHeard(appSettings().listenBrainzToken, outgoing, listenStartedAtRef.current, listenedMsRef.current);
        }
        sessionSeenRef.current.add(track.id);
        sendNowPlaying(appSettings().listenBrainzToken, track);
        listenStartedAtRef.current = Date.now();
        listenedMsRef.current = 0;
        lastProgressRef.current = startAt;
        if (recordHistory && outgoing && outgoing.id !== track.id) {
            historyRef.current = [outgoing, ...historyRef.current].slice(0, 50);
            setHistory(historyRef.current);
        }
        rememberPlayed(track);
        recordPlayedTrack(track).catch(() => undefined);
        setNotificationArtworkUri(undefined);
        setCurrentTrack(track);
        desiredPlayingRef.current = true;
        lastTransportIntentAtRef.current = Date.now();
        setIsPlaying(true);
        setCurrentTime(startAt);
        setDuration(0);
        previewRecoveryAttemptedRef.current = false;
        currentTimeRef.current = startAt;
        // onLoad seeks to a pending position once the stream is ready (used for jam late-join sync).
        pendingSeekRef.current = startAt > 0 ? startAt : null;
        fetchStream(track, qualityRef.current);
    }, [fetchStream, rememberPlayed]);

    const playTrack = useCallback((track: Track, startAt: number = 0) => {
        autoQueueRef.current = [];
        syncUpNext();
        startTrack(track, startAt, true);
    }, [startTrack, syncUpNext]);

    const playPlaylist = useCallback((tracks: Track[], startIndex = 0) => {
        if (!Number.isInteger(startIndex) || startIndex < 0 || !tracks[startIndex]) return;
        autoQueueRef.current = [];
        syncQueue(tracks.slice(startIndex + 1));
        startTrack(tracks[startIndex], 0, true);
    }, [startTrack, syncQueue]);

    const togglePlayPause = useCallback(() => {
        const next = !desiredPlayingRef.current;
        desiredPlayingRef.current = next;
        lastTransportIntentAtRef.current = Date.now();

        // Send the transport command straight to the native player. Updating the
        // React state as well keeps every control and the Android media session in sync.
        if (next) videoRef.current?.resume();
        else videoRef.current?.pause();
        setIsPlaying(next);
    }, []);

    const seek = useCallback((time: number) => {
        const target = Math.max(0, Math.min(time, duration > 0 ? duration : time));
        seekInFlightRef.current = true;
        if (seekGuardTimerRef.current) clearTimeout(seekGuardTimerRef.current);
        videoRef.current?.seek(target);
        setCurrentTime(target);
        currentTimeRef.current = target;

        // Some containers do not emit onSeek. End the guard safely without allowing
        // a transient native pause to become the user's requested transport state.
        seekGuardTimerRef.current = setTimeout(() => {
            seekInFlightRef.current = false;
            const shouldPlay = desiredPlayingRef.current;
            lastTransportIntentAtRef.current = Date.now();
            setIsPlaying(shouldPlay);
            if (shouldPlay) videoRef.current?.resume();
            else videoRef.current?.pause();
        }, 1500);
    }, [duration]);

    const setVolume = useCallback((v: number) => {
        setVolumeState(v);
    }, []);

    const setQuality = useCallback((q: StreamQuality) => {
        if (q === qualityRef.current && q === resolvedQualityRef.current) return;
        const track = currentTrackRef.current;
        // A downloaded file has one fixed encoded quality. Changing the streaming
        // preference must not unload or restart that local file.
        if (track?.localPath) return;

        qualityRef.current = q;
        void getPrefs().then(prefs => savePrefs({
            genres: prefs?.genres ?? [],
            artists: prefs?.artists ?? [],
            ...prefs,
            streamingQuality: q,
        }));
        // Audius fallback tracks are a fixed MP3 source. Remember the preference
        // for the next Tidal track without restarting the current MP3 needlessly.
        if (track?.source === 'audius') return;
        pendingSeekRef.current = currentTimeRef.current;
        if (track) fetchStream(track, q);
    }, [fetchStream]);
    setQualityRef.current = setQuality;

    const onProgress = useCallback((data: any) => {
        if (seekInFlightRef.current) return;
        // Only steady forward ticks count as listening; seeks and stalls do not.
        const delta = data.currentTime - lastProgressRef.current;
        if (delta > 0 && delta <= 2.5) listenedMsRef.current += delta * 1000;
        lastProgressRef.current = data.currentTime;
        setCurrentTime(data.currentTime);
        currentTimeRef.current = data.currentTime;
    }, []);

    const onLoad = useCallback((data: any) => {
        const loadedDuration = Number(data.duration) || 0;
        const activeTrack = currentTrackRef.current;
        // Some upstream manifests are codec-valid FLAC but contain only a
        // 30-second preview. Never present that as the requested full song.
        // Recover once through the exact-match public source, which reports
        // its real MP3 format and provides the complete track when available.
        if (
            loadedDuration > 0
            && loadedDuration <= 35
            && !previewRecoveryAttemptedRef.current
            && activeTrack
        ) {
            previewRecoveryAttemptedRef.current = true;
            if (activeTrack.localPath) {
                const onlineTrack = { ...activeTrack, localPath: undefined };
                currentTrackRef.current = onlineTrack;
                setCurrentTrack(onlineTrack);
                fetchStream(onlineTrack, qualityRef.current);
            } else {
                fallbackToDefaultSource(activeTrack);
            }
            return;
        }
        setDuration(loadedDuration);
        setIsBuffering(false);
        // Re-assert intent after a source replacement. ExoPlayer may emit a stale
        // paused callback while detaching the old source.
        setIsPlaying(desiredPlayingRef.current);
        if (streamReloadGuardTimerRef.current) clearTimeout(streamReloadGuardTimerRef.current);
        if (!desiredPlayingRef.current) {
            streamReloadingRef.current = false;
        } else {
            // ExoPlayer can deliver several delayed paused callbacks while replacing
            // a DASH preview with the full fallback. Keep the user's play intent
            // authoritative until the old decoder and AudioTrack are fully detached.
            streamReloadGuardTimerRef.current = setTimeout(() => {
                setIsPlaying(desiredPlayingRef.current);
                streamReloadingRef.current = false;
            }, 8000);
        }
        if (pendingSeekRef.current !== null) {
            const seekTo = pendingSeekRef.current;
            pendingSeekRef.current = null;
            seek(seekTo);
        } else if (desiredPlayingRef.current) {
            videoRef.current?.resume();
        } else {
            videoRef.current?.pause();
        }
    }, [fallbackToDefaultSource, fetchStream, seek]);

    const onSeek = useCallback((data: { currentTime: number; seekTime: number }) => {
        if (seekGuardTimerRef.current) clearTimeout(seekGuardTimerRef.current);
        const settledTime = Number.isFinite(data.currentTime) ? data.currentTime : data.seekTime;
        setCurrentTime(settledTime);
        currentTimeRef.current = settledTime;
        seekInFlightRef.current = false;

        // Seeking is a position change, not a play/pause instruction. Re-assert the
        // state the user had before the seek and reject the extractor's stale callback.
        const shouldPlay = desiredPlayingRef.current;
        lastTransportIntentAtRef.current = Date.now();
        setIsPlaying(shouldPlay);
        if (shouldPlay) videoRef.current?.resume();
        else videoRef.current?.pause();
    }, []);

    // ExoPlayer may have its own load-timeout shorter than lucida's server-side rip time,
    // so a fresh (still-downloading) track can error out before any bytes exist yet. Retry
    // reconnecting to the same tailing stream a few times rather than treating it as fatal.
    const onVideoError = useCallback(async (e: any) => {
        console.log('Audio error:', JSON.stringify(e));
        const track = currentTrackRef.current;
        const directDashUrl = directTidalDashUrlRef.current;
        if (track && directDashUrl && !tidalProxyAttemptedRef.current) {
            tidalProxyAttemptedRef.current = true;
            const requestId = streamRequestIdRef.current;
            streamReloadingRef.current = true;
            setIsBuffering(true);
            pendingSeekRef.current = currentTimeRef.current > 0 ? currentTimeRef.current : null;
            try {
                const manifest = await getTidalProxyDashManifest(directDashUrl);
                if (requestId !== streamRequestIdRef.current) return;
                if (manifest) {
                    const proxiedUrl = await resolveStream({ url: '', isDash: true, dashXml: manifest }, track.id);
                    if (requestId !== streamRequestIdRef.current) return;
                    setStreamUrl(null);
                    setTimeout(() => {
                        if (requestId === streamRequestIdRef.current) setStreamUrl(proxiedUrl);
                    }, 0);
                    return;
                }
            } catch (error) {
                console.log('TIDAL proxy fallback error:', error);
            }
            if (requestId === streamRequestIdRef.current) fallbackToDefaultSource(track, requestId);
            return;
        }
        if (track?.source === 'lucida' && lucidaPollRef.current && lucidaRetriesRef.current < 5) {
            lucidaRetriesRef.current += 1;
            const url = streamUrl;
            setStreamUrl(null);
            const requestId = streamRequestIdRef.current;
            setTimeout(() => {
                if (requestId === streamRequestIdRef.current) setStreamUrl(url);
            }, 2000);
            return;
        }
        // Progressive AAC/MP3 failures used to fall through without clearing
        // the spinner. Recover once, keep position, and stop cleanly if it fails.
        if (track && fallbackRequestRef.current !== streamRequestIdRef.current) {
            void fallbackToDefaultSource(track);
            return;
        }
        setIsBuffering(false);
        streamReloadingRef.current = false;
        desiredPlayingRef.current = false;
        setIsPlaying(false);
    }, [fallbackToDefaultSource, streamUrl]);

    // Builds a diverse radio batch from public ListenBrainz/MusicBrainz similarity
    // signals, then blends in the user's on-device listening profile. The service has
    // a same-artist/profile fallback, so playback still continues if either public API
    // is unavailable.
    const buildRecommendations = useCallback(async (): Promise<Track[]> => {
        const cur = currentTrackRef.current;
        if (!cur) return [];
        const session = playSessionRef.current;
        const pending = radioRequestRef.current;
        if (pending?.session === session) return pending.promise;
        const request = (async () => {
        const recent = new Set([cur.id, ...recentIdsRef.current, ...queueRef.current.map(track => track.id), ...autoQueueRef.current.map(track => track.id),
            ...(appSettings().noRepeatInSession ? sessionSeenRef.current : [])]);
        const uniq = await getRadioRecommendations(cur, recent, 60);
        uniq.forEach(track => sessionSeenRef.current.add(track.id));
        if (shuffleRef.current) {
            for (let i = uniq.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [uniq[i], uniq[j]] = [uniq[j], uniq[i]];
            }
        }
        return uniq;
        })();
        radioRequestRef.current = { session, promise: request };
        try { return await request; }
        finally { if (radioRequestRef.current?.promise === request) radioRequestRef.current = null; }
    }, []);

    // Prepare the next songs as soon as a track starts. The next/skip button can then
    // react immediately instead of waiting for recommendation network calls on press.
    useEffect(() => {
        if (!currentTrack) return;
        let cancelled = false;
        const session = playSessionRef.current;
        if (autoQueueRef.current.length < 15) buildRecommendations().then(items => {
            if (!cancelled && playSessionRef.current === session && items.length > 0) {
                autoQueueRef.current = appendRadioTracks(autoQueueRef.current, items, new Set([...recentIdsRef.current, ...queueRef.current.map(track => track.id)]));
                syncUpNext();
            }
        }).catch(() => { });
        return () => { cancelled = true; };
    }, [currentTrack, buildRecommendations, syncUpNext]);

    // Shared "what plays next" logic, used by both natural track-end and manual skip.
    // Priority: repeat-one → user queue → auto-recommendations → (repeat-all replays) → stop.
    const advanceToNextTrack = useCallback(async () => {
        if (advancePendingRef.current) return;
        advancePendingRef.current = true;
        const session = playSessionRef.current;
        try {
        const cur = currentTrackRef.current;
        if (repeatModeRef.current === 'one' && cur) { startTrack(cur, 0, false); return; }

        if (queueRef.current.length > 0) {
            const [next, ...rest] = queueRef.current;
            syncQueue(rest);
            startTrack(next, 0, true);
            return;
        }

        if (autoQueueRef.current.length === 0) {
            const more = await buildRecommendations();
            if (session !== playSessionRef.current) return;
            autoQueueRef.current = appendRadioTracks(autoQueueRef.current, more, new Set(recentIdsRef.current));
            syncUpNext();
        }
        // A song can be explicitly queued while recommendations are loading.
        // Re-check that priority after awaiting, rather than skipping past it.
        if (queueRef.current.length > 0) {
            const [queued, ...rest] = queueRef.current;
            syncQueue(rest);
            startTrack(queued, 0, true);
            return;
        }
        const next = autoQueueRef.current.shift();
        syncUpNext();
        // The next track's effect refills using its own session token, so an
        // obsolete request cannot insert songs after a manual playlist switch.
        if (next) { startTrack(next, 0, true); return; }

        if (repeatModeRef.current === 'all' && cur) { startTrack(cur, 0, false); return; }
        desiredPlayingRef.current = false;
        setIsPlaying(false);
        } catch {
            if (session === playSessionRef.current) {
                desiredPlayingRef.current = false;
                setIsPlaying(false);
                setIsBuffering(false);
            }
        } finally { advancePendingRef.current = false; }
    }, [startTrack, syncQueue, buildRecommendations, syncUpNext]);

    const playNext = useCallback((track?: Track) => {
        // Manual skip shouldn't hand control to the jam owner — that's only for natural
        // end-of-track. A track arg jumps straight to it; otherwise advance the queue.
        if (track) { autoQueueRef.current = []; syncUpNext(); startTrack(track, 0, true); return; }
        advanceToNextTrack();
    }, [startTrack, advanceToNextTrack, syncUpNext]);

    const playFromUpNext = useCallback((index: number) => {
        if (index < 0) return;

        const explicitCount = queueRef.current.length;
        if (index < explicitCount) {
            const selected = queueRef.current[index];
            if (!selected) return;
            // Skip the entries above the selected song, consume the selected song, and
            // retain both the explicit songs and Radio recommendations that follow it.
            syncQueue(queueRef.current.slice(index + 1));
            startTrack(selected, 0, true);
            return;
        }

        const autoIndex = index - explicitCount;
        const selected = autoQueueRef.current[autoIndex];
        if (!selected) return;
        // A Radio row appears after the explicit queue, so choosing it intentionally skips
        // those earlier entries while preserving every later recommendation.
        queueRef.current = [];
        setQueue([]);
        autoQueueRef.current = autoQueueRef.current.slice(autoIndex + 1);
        syncUpNext();
        startTrack(selected, 0, true);
    }, [startTrack, syncQueue, syncUpNext]);

    const playPrevious = useCallback(() => {
        // Apple-Music behaviour: >4s in, first press restarts the current track; otherwise
        // pop the history stack. Restart when there's nothing to go back to.
        if (currentTimeRef.current > 4) { seek(0); return; }
        const prev = historyRef.current[0];
        if (prev) {
            historyRef.current = historyRef.current.slice(1);
            startTrack(prev, 0, false);
        } else {
            seek(0);
        }
    }, [seek, startTrack]);

    const addToQueue = useCallback((track: Track) => {
        syncQueue([...queueRef.current, track]);
    }, [syncQueue]);

    const removeFromQueue = useCallback((index: number) => {
        syncQueue(queueRef.current.filter((_, i) => i !== index));
    }, [syncQueue]);

    const moveInQueue = useCallback((from: number, to: number) => {
        const next = queueRef.current.slice();
        if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return;
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        syncQueue(next);
    }, [syncQueue]);

    const playNextInQueue = useCallback((track: Track) => {
        syncQueue([track, ...queueRef.current.filter(item => item.id !== track.id)]);
    }, [syncQueue]);

    const clearQueue = useCallback(() => syncQueue([]), [syncQueue]);

    const cycleRepeat = useCallback(() => {
        setRepeatMode(prev => {
            const next = prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off';
            repeatModeRef.current = next;
            return next;
        });
    }, []);

    const toggleShuffle = useCallback(() => {
        setShuffle(prev => { shuffleRef.current = !prev; return !prev; });
    }, []);

    const onEnd = useCallback(async () => {
        // Jam (or any registered owner) gets first say on what happens at track end.
        if (onTrackEndRef.current) {
            try { if (onTrackEndRef.current()) return; } catch { /* fall through */ }
        }
        advanceToNextTrack();
    }, [advanceToNextTrack]);

    // Metadata for the OS media session — drives the lock screen, notification-bar
    // controls, and iOS Control Center / Dynamic Island Now Playing card. imageUri must
    // be an absolute URL (remote cover) or a file:// path for local downloads.
    const mediaMetadata = useMemo(() => {
        if (!currentTrack) return undefined;
        const artist = currentTrack.artist?.name || '';
        return {
            title: currentTrack.title || '',
            artist,
            subtitle: currentTrack.album?.title || '',
            description: artist,
            imageUri: notificationArtworkUri,
        };
    }, [currentTrack, notificationArtworkUri]);

    const playerSummary = useMemo<PlayerSummaryContextType>(() => ({
        currentTrack,
        isPlaying,
        playTrack,
        playFromUpNext,
        addToQueue,
        upNext,
    }), [addToQueue, currentTrack, isPlaying, playFromUpNext, playTrack, upNext]);

    return (
        <PlayerSummaryContext.Provider value={playerSummary}>
            <PlayerContext.Provider value={{
                currentTrack, isPlaying, isBuffering, currentTime, duration,
                volume, quality, playTrack, playPlaylist, togglePlayPause, seek, setVolume, setQuality,
                playNext, playPrevious, queue, upNext, history, playFromUpNext, addToQueue, removeFromQueue, moveInQueue, playNextInQueue, clearQueue,
                repeatMode, cycleRepeat, shuffle, toggleShuffle,
                setOnTrackEnd, verifiedFormat, lucidaProgress, usingFallback,
            }}>
                {children}
                {streamUrl && (
                    <Video
                    ref={videoRef}
                    // A remote .mpd is DASH — tell the player explicitly, because
                    // it does not reliably infer DASH from the URL alone (the
                    // manifest would load but never start, stuck at 0:00).
                    source={{
                        uri: streamUrl,
                        ...(/\.mpd(\?|$)/i.test(streamUrl) ? { type: 'mpd' as const } : {}),
                        metadata: mediaMetadata,
                    }}
                    paused={!isPlaying}
                    volume={volume}
                    onProgress={onProgress}
                    progressUpdateInterval={500}
                    onLoad={onLoad}
                    onSeek={onSeek}
                    onBuffer={({ isBuffering: b }: any) => setIsBuffering(b)}
                    onError={onVideoError}
                    onEnd={onEnd}
                    // OS-level media controls (lock screen, notification bar, Control Center).
                    // play/pause/seek are wired to the underlying player automatically.
                    showNotificationControls
                    onPlaybackStateChanged={({ isPlaying: playing }: any) => {
                        // Keep our state in sync when the user hits play/pause from the
                        // notification or lock screen rather than the in-app button. Ignore
                        // stale native state while a source is being replaced or immediately
                        // after an in-app tap; the user's intent is authoritative then.
                        if (typeof playing !== 'boolean') return;
                        const contradictsRecentTap = Date.now() - lastTransportIntentAtRef.current < 600
                            && playing !== desiredPlayingRef.current;
                        const contradictsSeek = seekInFlightRef.current
                            && playing !== desiredPlayingRef.current;
                        const contradictsReload = streamReloadingRef.current
                            && playing !== desiredPlayingRef.current;
                        if (contradictsRecentTap || contradictsSeek || contradictsReload) return;
                        desiredPlayingRef.current = playing;
                        setIsPlaying(playing);
                    }}
                    playInBackground
                    style={styles.hidden}
                    />
                )}
            </PlayerContext.Provider>
        </PlayerSummaryContext.Provider>
    );
}

const styles = StyleSheet.create({
    hidden: { width: 0, height: 0, position: 'absolute', opacity: 0 },
});
