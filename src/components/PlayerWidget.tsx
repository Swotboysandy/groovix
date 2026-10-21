import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
    View, Text, StyleSheet, Image,
    ActivityIndicator, Dimensions, FlatList,
    Platform, TouchableOpacity, BackHandler, StatusBar
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
    useSharedValue, useAnimatedStyle, withSpring,
    withTiming, Easing,
    runOnJS, runOnUI, interpolate, Extrapolation,
    cancelAnimation, interpolateColor, FadeIn, FadeOut,
} from 'react-native-reanimated';
import RNFS from 'react-native-fs';
import Ionicons from 'react-native-vector-icons/Ionicons';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import { useNavigation } from '@react-navigation/native';
import Slider from '@react-native-community/slider';
import TouchableScale from './TouchableScale';
import DraggableBottomSheet from './DraggableBottomSheet';
import SkeletonPulse from './SkeletonPulse';
import QueuePanel from './QueuePanel';
import { useSongMenu } from './SongMenu';
import { haptic } from '../services/haptics';
import { updateAppSettings, useAppSettings } from '../store/appSettings';
import { translateLyrics } from '../services/lyricsTranslation';

import { API, LyricLine, parseLRCString, parseTTMLString, getLastLyricsSource } from '../api';
import { usePlayer, StreamQuality, formatVerifiedQuality } from '../context/PlayerContext';
import type { Track } from '../types';
import { getListeningProfile, toggleLikedTrack } from '../store/listeningProfile';
import { downloadTrackForOffline, findDownloadedTrack } from '../services/downloads';
import { useTheme } from '../context/ThemeContext';
import { useAppDialog } from '../context/DialogContext';
import { getPrefs } from '../store/preferences';
import { GX_TYPE } from '../theme/groovix';

// CircleGlyph: 34dp disc at 18% white (34% when active), 19dp glyph.
function CircleGlyph({ icon, label, onPress, active = false, big = false }: { icon: string; label: string; onPress: () => void; active?: boolean; big?: boolean }) {
    return (
        <TouchableOpacity
            onPress={onPress}
            activeOpacity={0.7}
            style={[circleGlyphStyle.disc, big && circleGlyphStyle.big, { backgroundColor: active ? 'rgba(255,255,255,0.34)' : 'rgba(255,255,255,0.18)' }]}
            accessibilityRole="button"
            accessibilityLabel={label}
        >
            <Ionicons name={icon} size={19} color="#FFFFFF" />
        </TouchableOpacity>
    );
}

const LINE_FALLOFF_ALPHA = [1, 0.8, 0.7, 0.58, 0.46];

const circleGlyphStyle = StyleSheet.create({
    disc: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
    big: { width: 40, height: 40, borderRadius: 20 },
});

const queueTrackKey = (track: Track, index: number) => `player-queue-${track.id}-${index}`;

function fetchWithTimeout(url: string, opts: RequestInit, ms: number): Promise<Response> {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), ms);
        fetch(url, opts).then(r => { clearTimeout(t); resolve(r); }, e => { clearTimeout(t); reject(e); });
    });
}

function linesToLRC(lines: LyricLine[]): string {
    return lines.map(l => {
        const m = Math.floor(l.time / 60);
        const s = (l.time % 60).toFixed(2).padStart(5, '0');
        return `[${String(m).padStart(2, '0')}:${s}]${l.text}`;
    }).join('\n');
}

async function fetchAndSaveLyrics(track: Track, lrcPath: string): Promise<void> {
    try {
        // Try binimum (TTML format from Apple Music)
        let ttmlLines: LyricLine[] | null = null;
        try {
            const bp = track.isrc
                ? new URLSearchParams({ isrc: track.isrc })
                : (() => {
                    const q = new URLSearchParams({ track: track.title, artist: track.artist?.name || '' });
                    if (track.album?.title) q.append('album', track.album.title);
                    if (track.duration > 0) q.append('duration', Math.round(track.duration).toString());
                    return q;
                })();
            const r = await fetchWithTimeout(`https://lyrics-api.binimum.org/?${bp.toString()}`,
                { headers: { 'User-Agent': 'MusicPlayer/1.0' } }, 5000);
            if (r.ok) {
                const d = await r.json();
                const lyricsUrl: string | undefined = d?.results?.[0]?.lyricsUrl;
                if (lyricsUrl) {
                    const ttml = await fetchWithTimeout(lyricsUrl, { headers: { 'User-Agent': 'MusicPlayer/1.0' } }, 6000);
                    if (ttml.ok) ttmlLines = parseTTMLString(await ttml.text());
                }
            }
        } catch { }

        if (ttmlLines && ttmlLines.length > 0) {
            await RNFS.writeFile(lrcPath, linesToLRC(ttmlLines), 'utf8');
            return;
        }

        // Fall back to lrclib (native LRC format)
        try {
            const params = new URLSearchParams({ track_name: track.title, artist_name: track.artist?.name || '' });
            if (track.album?.title) params.append('album_name', track.album.title);
            if (track.duration > 0) params.append('duration', Math.round(track.duration).toString());
            const r = await fetchWithTimeout(`https://lrclib.net/api/get?${params.toString()}`,
                { headers: { 'User-Agent': 'MusicPlayer/1.0' } }, 6000);
            if (r.ok) {
                const d = await r.json();
                const raw = d.syncedLyrics || d.plainLyrics || '';
                if (raw) await RNFS.writeFile(lrcPath, raw, 'utf8');
            }
        } catch { }
    } catch { }
}

function AmbientBackground({ trackId, coverUrl, enabled }: { trackId: number; coverUrl: string; enabled: boolean }) {
    const fadeA = useSharedValue(0);
    const [imgA, setImgA] = useState(coverUrl);

    // Cross-fade to new artwork when track changes
    useEffect(() => {
        fadeA.value = withTiming(0, { duration: 150, easing: Easing.out(Easing.quad) }, () => {
            runOnJS(setImgA)(coverUrl);
            fadeA.value = withTiming(1, { duration: 210, easing: Easing.in(Easing.quad) });
        });
    }, [coverUrl, fadeA, trackId]);

    const artStyle  = useAnimatedStyle(() => ({
        opacity: fadeA.value,
    }));

    return (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {/* Blurred poster at full opacity — colors come from the art itself */}
            {enabled && (
                <Animated.Image
                    source={{ uri: imgA }}
                    style={[StyleSheet.absoluteFill, artStyle]}
                    blurRadius={12}
                    resizeMode="cover"
                />
            )}
        </View>
    );
}

// Custom horizontal volume slider using RNGH Pan — avoids native Slider conflict in Fabric mode
function VolumeSlider({ value, onChange, onSlide }: { value: number; onChange: (v: number) => void; onSlide?: (v: number) => void }) {
    const pct = useSharedValue(value);
    const startPct = useSharedValue(value);
    const barW = useSharedValue(200);
    const thumbScale = useSharedValue(0);
    const trackH = useSharedValue(6);

    useEffect(() => { pct.value = value; }, [pct, value]);

    const SPRING_IN  = { damping: 14, stiffness: 320, mass: 0.6 };
    const SPRING_OUT = { damping: 18, stiffness: 380, mass: 0.5 };

    const drag = Gesture.Pan()
        .activeOffsetX([-3, 3])
        .failOffsetY([-10, 10])
        .onStart(() => {
            'worklet';
            startPct.value = pct.value;
            trackH.value = withSpring(10, SPRING_IN);
        })
        .onUpdate(e => {
            'worklet';
            pct.value = Math.max(0, Math.min(1, startPct.value + e.translationX / barW.value));
            if (onSlide) runOnJS(onSlide)(pct.value);
        })
        .onEnd(() => {
            'worklet';
            trackH.value = withSpring(6, SPRING_OUT);
            runOnJS(onChange)(pct.value);
        });

    const railStyle  = useAnimatedStyle(() => ({ height: trackH.value }));
    const fillStyle  = useAnimatedStyle(() => ({ width: pct.value * barW.value, height: trackH.value }));
    const thumbStyle = useAnimatedStyle(() => ({
        transform: [
            { translateX: pct.value * barW.value - 7 },
            { scale: thumbScale.value },
        ],
    }));

    return (
        <GestureDetector gesture={drag}>
            <View
                style={vSliderStyles.track}
                onLayout={e => { barW.value = e.nativeEvent.layout.width; }}
            >
                <Animated.View style={[vSliderStyles.rail, railStyle]} />
                <Animated.View style={[vSliderStyles.fill, fillStyle]} />
                <Animated.View style={[vSliderStyles.thumb, thumbStyle]} />
            </View>
        </GestureDetector>
    );
}

const vSliderStyles = StyleSheet.create({
    track: { flex: 1, height: 36, justifyContent: 'center', position: 'relative' },
    rail:  { position: 'absolute', left: 0, right: 0, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.25)' },
    fill:  { position: 'absolute', left: 0, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.92)' },
    thumb: { position: 'absolute', top: 11, width: 14, height: 14, borderRadius: 7, backgroundColor: '#fff' },
});

const QUALITY_OPTIONS: { label: string; desc: string; value: StreamQuality }[] = [
    { label: 'Hi-Res', desc: '24-bit FLAC (DASH) up to 192 kHz', value: 'HI_RES_LOSSLESS' },
    { label: 'CD Lossless', desc: '16-bit / 44.1 kHz FLAC', value: 'LOSSLESS' },
    { label: '320kbps AAC', desc: 'High quality AAC streaming', value: 'HIGH' },
    { label: '96kbps AAC', desc: 'Data saver AAC streaming', value: 'LOW' },
];

const { width, height: WINDOW_HEIGHT } = Dimensions.get('window');
// Floating tab bar pill (~72dp) + its 14dp bottom inset + 10dp gap above it.
const TAB_BAR_HEIGHT = 96;
const MINI_HEIGHT = 60;
// The player owns only the area above the persistent tab bar. Keeping the
// expanded and minimized states in the same fixed viewport avoids the old
// mid-drag height switch that could leave a large, empty blurred panel visible.
const FULL_ARTWORK_SIZE = width;
const MINI_ARTWORK_SIZE = 40;

const SPRING_CONFIG = { damping: 27.93, stiffness: 195, mass: 1 };
// One 420ms ease for the sleeve collapsing into the lyrics/queue header.
const PANEL_EASE = Easing.bezier(0.4, 0, 0.2, 1);
const PANEL_MS = 420;
// Where the collapsed sleeve lands: the header thumbnail under the grabber.
const HEADER_THUMB_SIZE = 54;
const HEADER_THUMB_X = 24;
const HEADER_THUMB_DROP = 27;
// The sleeve shrinks back while paused, on a soft low-bounce spring.
const PAUSE_SCALE = 0.86;
const PAUSE_SPRING = { damping: 21.2, stiffness: 200, mass: 1 };
const LYRICS_SPRING_CONFIG = {
    damping: 30,
    stiffness: 420,
    mass: 0.78,
    overshootClamping: true,
};
const VELOCITY_THRESHOLD = 600;

const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
};

export default function PlayerWidget() {
    const {
        currentTrack, isPlaying, isBuffering, currentTime, duration,
        volume, quality, togglePlayPause, seek, setVolume, setQuality, playNext,
        playPrevious, shuffle, toggleShuffle, repeatMode, cycleRepeat,
        verifiedFormat, lucidaProgress, usingFallback, queue, upNext, history, playTrack, loadMoreUpNext,
        playFromUpNext, removeFromQueue, moveInQueue, clearQueue,
    } = usePlayer();
    const { colors } = useTheme();
    const { showDialog } = useAppDialog();

    // Real, verified format of what's actually playing (null until probed) - never show a
    // claimed/requested quality on the badge. Sources we don't ffprobe server-side (Tidal,
    // Audiomack) have no way to be verified at all, so they say so explicitly - "Unverified"
    // is not the same claim as "FLAC" and must never be confused with it. A deemix track that
    // fell back to Tidal (mirror was down) is playing Tidal audio now, not the verified FLAC,
    // so it must show Unverified too - the source label alone would lie about that.
    const verifiedLabel = formatVerifiedQuality(verifiedFormat);
    const canVerify = currentTrack?.source === 'lucida' && currentTrack?.provider !== 'tidal' && !usingFallback;
    const qualityBadge = verifiedLabel || (isBuffering || lucidaProgress ? '…' : (canVerify ? '—' : 'Unverified'));

    const [showQualityModal, setShowQualityModal] = useState(false);
    const [showQueue, setShowQueue] = useState(false);
    const [playerExpanded, setPlayerExpanded] = useState(false);
    const playerExpandedRef = useRef(false);
    playerExpandedRef.current = playerExpanded;
    const [scrubTime, setScrubTime] = useState<number | null>(null);
    const displayedPlaying = isPlaying;
    const displayedTime = scrubTime ?? currentTime;

    const finishScrub = useCallback((value: number) => {
        seek(value);
        setScrubTime(null);
    }, [seek]);

    const insets = useSafeAreaInsets();
    // The space the app actually gets. On phones with on-screen nav buttons the
    // reported window height can include the button bar, which would park the
    // mini player on top of the tab bar; measuring the container avoids that.
    const [height, setHeight] = useState(WINDOW_HEIGHT);
    const PLAYER_HEIGHT = height - TAB_BAR_HEIGHT;
    const MINIMIZED_Y = PLAYER_HEIGHT - MINI_HEIGHT;
    const settings = useAppSettings();
    // Full-screen cover art runs the art to the edges from the very top; off, it is
    // a square sleeve inside the 30dp gutter with an 8dp corner.
    const fullBleed = settings.fullScreenCoverArt;
    const SLEEVE_SIZE = fullBleed ? FULL_ARTWORK_SIZE : FULL_ARTWORK_SIZE - 60;
    const SLEEVE_X = fullBleed ? 0 : 30;
    const FULL_ARTWORK_Y = fullBleed ? 0 : Math.max(insets.top, 20) + 40;
    const FULL_INFO_Y = FULL_ARTWORK_Y + SLEEVE_SIZE + (fullBleed ? 40 : 24);
    const DECK_TOP = FULL_INFO_Y + 70;
    // Title (lineHeight 28) + artist marginTop (4) + artist (lineHeight 22) - the real
    // rendered height of the text block, not the "~70" guess the old layout used.
    const TEXT_BLOCK_HEIGHT = 28 + 4 + 22;
    // Actual flow height consumed by dragHandleRow + header before the controls block
    // (16 dragHandleRow + 10 header marginTop + 28 header content + 30 header marginBottom).
    const HEADER_FLOW_HEIGHT = 16 + 10 + 28 + 30;
    // Derive the controls' marginTop from the SAME artwork/text coordinates instead of an
    // independent guessed constant - keeps them from drifting apart (was the "misplaced
    // play button" bug: two unrelated positioning systems for what should be one layout).
    const CONTROLS_MARGIN_TOP = (FULL_INFO_Y + TEXT_BLOCK_HEIGHT) - (insets.top + HEADER_FLOW_HEIGHT);

    const dragY = useSharedValue(MINIMIZED_Y);
    // When the measured height settles, keep a minimised player sitting on its new line.
    useEffect(() => {
        if (!playerExpandedRef.current) dragY.value = MINIMIZED_Y;
    }, [MINIMIZED_Y, dragY]);
    const lyricsTranslateY = useSharedValue(height);
    const lyricsContext = useSharedValue(0);
    const lyricsIsDragging = useSharedValue(0);
    const [showLyrics, setShowLyrics] = useState(false);
    const [downloadState, setDownloadState] = useState<'idle' | 'downloading' | 'done'>('idle');
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [downloadError, setDownloadError] = useState<string | null>(null);
    const downloadToken = useRef(0);
    const [isLiked, setIsLiked] = useState(false);

    // Lyrics state
    const [lyrics, setLyrics] = useState<LyricLine[]>([]);
    const [lyricsLoading, setLyricsLoading] = useState(false);
    const lyricsListRef = useRef<FlatList>(null);
    const [lyricsSource, setLyricsSource] = useState<string | null>(null);
    const navigation = useNavigation<any>();
    const songMenu = useSongMenu();
    // 1 while the artwork shows, 0 while lyrics take its place.
    const lyricsOpen = useSharedValue(1);
    useEffect(() => {
        if (showLyrics || showQueue) lyricsOpen.value = withTiming(0, { duration: panelMs, easing: PANEL_EASE });
    }, [showLyrics, showQueue, lyricsOpen]);
    const artScale = useSharedValue(1);
    useEffect(() => {
        const target = isPlaying || settings.reduceAnimation ? 1 : PAUSE_SCALE;
        artScale.value = settings.reduceAnimation ? target : withSpring(target, PAUSE_SPRING);
    }, [isPlaying, artScale, settings.reduceAnimation]);
    const panelMs = settings.reduceAnimation ? 0 : PANEL_MS;
    const lastScrolledIndex = useRef(-1);
    // Lyrics translated into the language picked in Settings, one per line.
    const [translations, setTranslations] = useState<string[] | null>(null);
    useEffect(() => {
        setTranslations(null);
        const target = settings.translationLanguage;
        if (!target || !currentTrack || lyrics.length === 0) return;
        let live = true;
        translateLyrics(`${currentTrack.id}`, lyrics.map(line => line.text || ''), target).then(result => { if (live) setTranslations(result); });
        return () => { live = false; };
    }, [lyrics, currentTrack, settings.translationLanguage]);

    // Reset download state and check if already saved when track changes
    useEffect(() => {
        downloadToken.current += 1;
        setDownloadProgress(0);
        setDownloadError(null);
        if (!currentTrack) { setDownloadState('idle'); return; }
        setDownloadState('idle');
        (async () => {
            if (await findDownloadedTrack(currentTrack)) setDownloadState('done');
        })();
    }, [currentTrack]);

    useEffect(() => {
        if (!currentTrack) { setIsLiked(false); return; }
        getListeningProfile().then(profile => setIsLiked(profile.likedTrackIds.includes(currentTrack.id)));
    }, [currentTrack]);

    const handleLike = async () => {
        if (!currentTrack) return;
        setIsLiked(await toggleLikedTrack(currentTrack));
    };

    const playFromQueue = useCallback((index: number) => {
        playFromUpNext(index);
    }, [playFromUpNext]);

    // Stable list props keep the queue from re-rendering on each audio-clock tick.
    const renderQueueTrack = useCallback(({ item, index }: { item: Track; index: number }) => {
        const explicitlyQueued = index < queue.length;
        return (
            <TouchableOpacity style={styles.queueRow} onPress={() => playFromQueue(index)} activeOpacity={0.72} accessibilityRole="button" accessibilityLabel={`Play ${item.title} next`}>
                <Text style={styles.queueIndex}>{String(index + 1).padStart(2, '0')}</Text>
                <Image source={{ uri: API.getCoverUrl(item.album?.cover, 140) }} style={styles.queueCover} />
                <View style={styles.queueTrackCopy}>
                    <Text style={styles.queueTrackTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.queueTrackArtist} numberOfLines={1}>{item.artist?.name} · {explicitlyQueued ? 'Queued' : 'Groovix Radio'}</Text>
                </View>
                {explicitlyQueued ? (
                    <TouchableOpacity onPress={() => removeFromQueue(index)} style={styles.queueRemoveButton} hitSlop={{ top: 9, bottom: 9, left: 9, right: 9 }} accessibilityRole="button" accessibilityLabel={`Remove ${item.title} from queue`}>
                        <Ionicons name="close" size={20} color="rgba(255,255,255,0.52)" />
                    </TouchableOpacity>
                ) : <Ionicons name="play" size={17} color="rgba(255,255,255,0.58)" />}
            </TouchableOpacity>
        );
    }, [queue.length, playFromQueue, removeFromQueue]);

    const confirmClearQueue = () => {
        showDialog({
            title: 'Clear queued songs?',
            message: 'Groovix Radio recommendations will remain available.',
            icon: 'list-outline',
            actions: [
                { text: 'Cancel', tone: 'neutral' },
                { text: 'Clear queue', tone: 'destructive', onPress: clearQueue },
            ],
        });
    };

    const handleDownload = async () => {
        if (!currentTrack || downloadState === 'downloading' || downloadState === 'done') return;
        const token = ++downloadToken.current;
        setDownloadState('downloading');
        setDownloadProgress(0.02);
        setDownloadError(null);
        try {
            const prefs = await getPrefs();
            const downloadQuality = prefs?.downloadQuality ?? quality;
            const result = await downloadTrackForOffline(currentTrack, downloadQuality, update => {
                if (downloadToken.current === token) setDownloadProgress(update.progress);
            });
            const lyricPath = result.path.replace(/\.[^/.]+$/, '.lrc');
            void fetchAndSaveLyrics(currentTrack, lyricPath);
            if (downloadToken.current !== token) return;
            setDownloadProgress(1);
            setDownloadState('done');
        } catch (e: any) {
            if (downloadToken.current !== token) return;
            const message = e?.message || 'Could not download this song.';
            setDownloadError(message);
            setDownloadState('idle');
            showDialog({
                title: 'Download failed',
                message,
                icon: 'cloud-offline-outline',
                actions: [
                    { text: 'Cancel', tone: 'neutral' },
                    { text: 'Try again', tone: 'primary', onPress: handleDownload },
                ],
            });
        }
    };

    useEffect(() => {
        let cancelled = false;
        if (!currentTrack) return;
        (async () => {
            setLyricsLoading(true);
            setLyrics([]);
            try {
                // Check for locally saved .lrc file first
                const safeName = `${currentTrack.artist?.name || 'Unknown'} - ${currentTrack.title}`
                    .replace(/[^a-z0-9 \-]/gi, '').trim().substring(0, 60);
                const lrcPath = `${RNFS.DownloadDirectoryPath}/${safeName}.lrc`;
                const hasLocal = await RNFS.exists(lrcPath);
                if (hasLocal) {
                    const raw = await RNFS.readFile(lrcPath, 'utf8');
                    const parsed = parseLRCString(raw);
                    if (!cancelled && parsed.length > 0) { setLyrics(parsed); return; }
                }
                const data = await API.getLyrics(
                    currentTrack.title, currentTrack.artist?.name || '',
                    currentTrack.album?.title || '', currentTrack.duration || 0,
                    currentTrack.isrc,
                );
                if (!cancelled) { setLyrics(data); setLyricsSource(getLastLyricsSource()); }
            } catch { }
            finally { if (!cancelled) setLyricsLoading(false); }
        })();
        return () => { cancelled = true; };
    }, [currentTrack]);

    const currentLyricIndex = useMemo(() => {
        if (lyrics.length === 0) return -1;
        const hasTiming = lyrics.some(l => l.time >= 0);
        if (!hasTiming) return -1;
        for (let i = lyrics.length - 1; i >= 0; i--) {
            if (lyrics[i].time >= 0 && currentTime >= lyrics[i].time) return i;
        }
        return -1;
    }, [currentTime, lyrics]);

    useEffect(() => {
        if (settings.syncedLyrics && currentLyricIndex >= 0 && showLyrics && currentLyricIndex !== lastScrolledIndex.current) {
            lastScrolledIndex.current = currentLyricIndex;
            try {
                lyricsListRef.current?.scrollToIndex({
                    index: currentLyricIndex, animated: true, viewPosition: 0.35,
                });
            } catch { }
        }
    }, [currentLyricIndex, showLyrics]);

    useEffect(() => {
        const sub = BackHandler.addEventListener('hardwareBackPress', () => {
            if (dragY.value < MINIMIZED_Y * 0.5) {
                setPlayerExpanded(false);
                runOnUI(() => {
                    'worklet';
                    dragY.value = withSpring(MINIMIZED_Y, SPRING_CONFIG);
                })();
                return true;
            }
            return false;
        });
        return () => sub.remove();
    }, [dragY]);

    const closePanels = () => { setShowLyrics(false); setShowQueue(false); };
    const togglePanel = (kind: 'lyrics' | 'queue') => {
        const open = kind === 'lyrics' ? showLyrics : showQueue;
        if (open) {
            // The panel fades while the sleeve grows back, then unmounts.
            lyricsOpen.value = withTiming(1, { duration: panelMs, easing: PANEL_EASE }, finished => {
                if (finished) runOnJS(closePanels)();
            });
            return;
        }
        const alreadyUp = showLyrics || showQueue;
        setShowLyrics(kind === 'lyrics');
        setShowQueue(kind === 'queue');
        if (!alreadyUp) {
            cancelAnimation(lyricsTranslateY);
            lyricsTranslateY.value = 0;
        }
    };
    const toggleLyrics = () => togglePanel('lyrics');
    // Opening the player swells in, as the mini player grows to fill the screen.
    const wasExpanded = useRef(false);
    useEffect(() => {
        if (playerExpanded && !wasExpanded.current) haptic('expand');
        wasExpanded.current = playerExpanded;
    }, [playerExpanded]);
    // Collapsing the player puts lyrics and the queue away with it.
    useEffect(() => {
        if (playerExpanded) return;
        cancelAnimation(lyricsTranslateY);
        lyricsTranslateY.value = height;
        lyricsOpen.value = 1;
        setShowLyrics(false);
        setShowQueue(false);
    }, [playerExpanded, lyricsTranslateY, lyricsOpen, height]);
    const toggleQueue = () => togglePanel('queue');

    const lyricsGesture = Gesture.Pan()
        .activeOffsetY([-5, 5])
        .failOffsetX([-14, 14])
        .onStart(() => {
            'worklet';
            cancelAnimation(lyricsTranslateY);
            lyricsContext.value = lyricsTranslateY.value;
            lyricsIsDragging.value = withTiming(1, { duration: 90 });
        })
        .onUpdate((e) => {
            'worklet';
            const nextY = lyricsContext.value + e.translationY;
            // A small amount of resistance above the open position keeps the
            // drawer attached to the finger without letting it drift offscreen.
            lyricsTranslateY.value = nextY < 0
                ? nextY * 0.08
                : Math.min(height, nextY);
        })
        .onEnd((e) => {
            'worklet';
            lyricsIsDragging.value = withTiming(0, { duration: 120 });
            const currentY = Math.max(0, lyricsTranslateY.value);
            const projectedY = currentY + Math.max(0, e.velocityY) * 0.18;
            const shouldClose = e.velocityY > 720 || projectedY > height * 0.22;

            if (shouldClose) {
                lyricsOpen.value = withTiming(1, { duration: panelMs, easing: PANEL_EASE });
                lyricsTranslateY.value = withTiming(
                    height,
                    { duration: 260, easing: Easing.out(Easing.cubic) },
                    () => runOnJS(closePanels)(),
                );
            } else {
                lyricsTranslateY.value = withSpring(0, LYRICS_SPRING_CONFIG);
            }
        });

    const contextY = useSharedValue(0);
    const panGesture = Gesture.Pan()
        .enabled(!showLyrics)
        .activeOffsetY([-10, 10])
        .failOffsetX([-20, 20])
        .onStart(() => {
            'worklet';
            contextY.value = dragY.value;
        })
        .onUpdate((e) => {
            'worklet';
            dragY.value = Math.max(0, Math.min(MINIMIZED_Y, contextY.value + e.translationY));
        })
        .onEnd((e) => {
            'worklet';
            if (e.velocityY > VELOCITY_THRESHOLD) {
                runOnJS(setPlayerExpanded)(false);
                dragY.value = withSpring(MINIMIZED_Y, SPRING_CONFIG);
            } else if (e.velocityY < -VELOCITY_THRESHOLD) {
                runOnJS(setPlayerExpanded)(true);
                dragY.value = withSpring(0, SPRING_CONFIG);
            } else {
                if (dragY.value > MINIMIZED_Y / 2) {
                    runOnJS(setPlayerExpanded)(false);
                    dragY.value = withSpring(MINIMIZED_Y, SPRING_CONFIG);
                } else {
                    runOnJS(setPlayerExpanded)(true);
                    dragY.value = withSpring(0, SPRING_CONFIG);
                }
            }
        });

    const tapGesture = Gesture.Tap()
        .enabled(!showLyrics)
        .onStart(() => {
            'worklet';
            if (dragY.value > MINIMIZED_Y * 0.8) {
                runOnJS(setPlayerExpanded)(true);
                dragY.value = withSpring(0, SPRING_CONFIG);
            }
        });

    const mainGesture = Gesture.Race(panGesture, tapGesture);

    // ==========================================
    // SEAMLESS MORPHING ANIMATIONS
    // ==========================================

    // Translate one fixed-height viewport. At MINIMIZED_Y exactly MINI_HEIGHT
    // remains visible, while the tab bar stays outside the player hit area.
    // Clip to the area above the tab bar only once minimised, so the expanded
    // player covers the whole screen while the tab bar keeps
    // its touches.
    const viewportStyle = useAnimatedStyle(() => ({
        height: interpolate(dragY.value / MINIMIZED_Y, [0, 0.98, 1], [height, height, PLAYER_HEIGHT], Extrapolation.CLAMP),
    }));

    const widgetRootStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: dragY.value }],
    }));

    const bgOpacityStyle = useAnimatedStyle(() => {
        const p = dragY.value / MINIMIZED_Y;
        return { opacity: 1 - p };
    });
    // The faded-foot sleeve gives way to a plain square as it becomes a thumbnail.
    const sleeveFadeStyle = useAnimatedStyle(() => ({ opacity: fullBleed ? (1 - dragY.value / MINIMIZED_Y) * lyricsOpen.value : 0 }));
    const sleevePlainStyle = useAnimatedStyle(() => ({ opacity: fullBleed ? Math.max(dragY.value / MINIMIZED_Y, 1 - lyricsOpen.value) : 1 }));

    // Border radius fades out when going to mini, but we also want solid background for mini
    const miniBgStyle = useAnimatedStyle(() => {
        const p = dragY.value / MINIMIZED_Y;
        return { opacity: p };
    });

    // Artwork interpolates between mini size / pos and full size / pos
    const artworkStyle = useAnimatedStyle(() => {
        const p = dragY.value / MINIMIZED_Y; // 0 = Full, 1 = Mini
        const c = 1 - lyricsOpen.value; // 0 = sleeve, 1 = header thumbnail
        const headerY = Math.max(insets.top, 20) + HEADER_THUMB_DROP;
        const fullSize = interpolate(c, [0, 1], [SLEEVE_SIZE, HEADER_THUMB_SIZE]);
        const fullX = interpolate(c, [0, 1], [SLEEVE_X, HEADER_THUMB_X]);
        const fullY = interpolate(c, [0, 1], [FULL_ARTWORK_Y, headerY]);
        const size = interpolate(p, [0, 1], [fullSize, MINI_ARTWORK_SIZE]);
        const x = interpolate(p, [0, 1], [fullX, 28]); // full-bleed -> mini pill
        const y = interpolate(p, [0, 1], [fullY, 9]);
        const r = interpolate(p, [0, 1], [interpolate(c, [0, 1], [fullBleed ? 0 : 8, 8]), 8]);
        // Paused shrink only on the full sleeve, around its centre.
        const pause = interpolate(p + c, [0, 1], [artScale.value, 1], Extrapolation.CLAMP);
        return {
            width: size,
            height: size,
            borderRadius: r,
            transform: [{ translateX: x }, { translateY: y }, { scale: pause }]
        };
    });

    // Title / Artist interpolates between positions and font sizes
    const textInfoStyle = useAnimatedStyle(() => {
        const p = dragY.value / MINIMIZED_Y;
        const x = interpolate(p, [0, 1], [32, 28 + MINI_ARTWORK_SIZE + 10]);
        const y = interpolate(p, [0, 1], [FULL_INFO_Y, 10]);
        return {
            opacity: p > 0.5 ? 1 : lyricsOpen.value,
            transform: [{ translateX: x }, { translateY: y }]
        };
    });

    const titleStyle = useAnimatedStyle(() => ({
        color: interpolateColor(
            dragY.value / MINIMIZED_Y,
            [0, 0.78, 1],
            ['#FFFFFF', '#FFFFFF', colors.text],
        ),
        fontSize: interpolate(dragY.value / MINIMIZED_Y, [0, 1], [20, 16]),
        lineHeight: interpolate(dragY.value / MINIMIZED_Y, [0, 1], [25, 21]),
        // Full width leaves room for the two circle glyphs on the right.
        width: interpolate(dragY.value / MINIMIZED_Y, [0, 1], [width - 64 - 60, width - 196])
    }));

    const artistStyle = useAnimatedStyle(() => ({
        color: interpolateColor(
            dragY.value / MINIMIZED_Y,
            [0, 0.78, 1],
            ['rgba(255,255,255,0.6)', 'rgba(255,255,255,0.6)', colors.textMuted],
        ),
        fontSize: interpolate(dragY.value / MINIMIZED_Y, [0, 1], [20, 14]),
        lineHeight: interpolate(dragY.value / MINIMIZED_Y, [0, 1], [25, 19]),
        marginTop: interpolate(dragY.value / MINIMIZED_Y, [0, 1], [0, 1])
    }));

    // Fade in/out logic for controls
    const fullControlsStyle = useAnimatedStyle(() => ({
        opacity: interpolate(dragY.value / MINIMIZED_Y, [0, 0.3], [1, 0], Extrapolation.CLAMP),
        pointerEvents: dragY.value < MINIMIZED_Y / 2 ? 'auto' : 'none' as any,
    }));

    const miniControlsStyle = useAnimatedStyle(() => ({
        opacity: interpolate(dragY.value / MINIMIZED_Y, [0.7, 1], [0, 1], Extrapolation.CLAMP),
        pointerEvents: dragY.value > MINIMIZED_Y / 2 ? 'auto' : 'none' as any,
    }));

    const lyricsAnimStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: lyricsTranslateY.value }],
        opacity: (1 - lyricsOpen.value) * interpolate(
            lyricsTranslateY.value,
            [0, height * 0.86, height],
            [1, 1, 0.96],
            Extrapolation.CLAMP,
        ),
    }));

    const lyricsHandleStyle = useAnimatedStyle(() => ({
        opacity: interpolate(lyricsIsDragging.value, [0, 1], [0.45, 0.9]),
        transform: [{ scaleX: interpolate(lyricsIsDragging.value, [0, 1], [1, 1.22]) }],
    }));

    const renderLyricLine = useCallback(({ item, index }: { item: LyricLine; index: number }) => {
        // Synced lyrics off: a plain sheet of text, nothing lit or followed.
        const synced = settings.syncedLyrics;
        const isActive = synced && index === currentLyricIndex;
        const hasTiming = synced && item.time >= 0;
        // LINE_FALLOFF_ALPHA: lines fade with their distance from the sung one;
        // already-sung lines sit at the unsung alpha.
        const distance = Math.abs(index - currentLyricIndex);
        // Blur unfocused lyrics off: every other line at one even level.
        const opacity = !hasTiming ? 1 : isActive ? 1 : !settings.blurUnfocusedLyrics ? 0.6 : index < currentLyricIndex ? 0.45 : LINE_FALLOFF_ALPHA[Math.min(distance, LINE_FALLOFF_ALPHA.length - 1)] * 0.45;
        return (
            <TouchableOpacity
                style={[styles.lyricLineContainer, { transform: [{ scale: isActive || !hasTiming ? 1 : 0.98 }] }]}
                activeOpacity={0.6}
                disabled={!hasTiming}
                onPress={() => seek(item.time)}
                accessibilityRole="button"
                accessibilityLabel={`Jump to lyric ${item.text}`}
            >
                <Text style={[styles.lyricText, { opacity }]}>{item.text || '♪'}</Text>
                {translations?.[index] && item.text ? <Text style={[styles.lyricTranslation, { opacity }]}>{translations[index]}</Text> : null}
            </TouchableOpacity>
        );
    }, [currentLyricIndex, seek, settings.syncedLyrics, settings.blurUnfocusedLyrics, translations]);

    if (!currentTrack) return null;

    return (
        <View
            style={styles.absoluteContainer}
            pointerEvents="box-none"
            onLayout={event => {
                const measured = Math.round(event.nativeEvent.layout.height);
                if (measured > 0 && Math.abs(measured - height) > 1) setHeight(measured);
            }}
        >
            {settings.hideStatusBarInPlayer && playerExpanded ? <StatusBar hidden animated /> : null}
            <Animated.View style={[styles.playerViewport, viewportStyle]} pointerEvents="box-none">
                <GestureDetector gesture={mainGesture}>
                    <Animated.View style={[styles.widgetRoot, { height }, widgetRootStyle]}>

                    {/* BACKGROUNDS */}
                    <Animated.View style={[StyleSheet.absoluteFill, miniBgStyle]}>
                        <View style={[styles.miniPill, { backgroundColor: 'rgba(30,30,32,0.94)' }]} />
                    </Animated.View>
                    <Animated.View style={[StyleSheet.absoluteFill, bgOpacityStyle, { backgroundColor: '#000' }]}>
                        <AmbientBackground trackId={currentTrack.id} coverUrl={API.getCoverUrl(currentTrack.album?.cover, 360)} enabled={playerExpanded && !settings.reduceBlur} />
                        {/* Scrim: keeps white icons/text readable over bright or light-colored artwork */}
                        <View style={styles.scrim} pointerEvents="none" />
                    </Animated.View>

                    {/* MORPHING ARTWORK */}
                    <Animated.View style={[styles.artworkAbsolute, artworkStyle]}>
                        {/* Expanded: the art's foot dissolves into the blurred backdrop below it. */}
                        <Animated.View style={[StyleSheet.absoluteFill, sleeveFadeStyle]} pointerEvents="none">
                            <MaskedView style={StyleSheet.absoluteFill} maskElement={<LinearGradient colors={['#000000', '#000000', 'rgba(0,0,0,0.55)', 'transparent']} locations={[0, 0.55, 0.8, 1]} style={StyleSheet.absoluteFill} />}>
                                <Image style={styles.artwork} source={{ uri: API.getCoverUrl(currentTrack.album?.cover, 640) }} />
                            </MaskedView>
                        </Animated.View>
                        {/* Mini: the plain square thumbnail. */}
                        <Animated.View style={[StyleSheet.absoluteFill, sleevePlainStyle]} pointerEvents="none">
                            <Image style={styles.artwork} source={{ uri: API.getCoverUrl(currentTrack.album?.cover, 640) }} />
                        </Animated.View>
                    </Animated.View>

                    {/* MORPHING TEXT */}
                    <Animated.View style={[styles.textAbsolute, textInfoStyle]}>
                        <Animated.Text style={[styles.trackTitle, titleStyle]} numberOfLines={1}>{currentTrack.title}</Animated.Text>
                        <Animated.Text style={[styles.trackArtist, artistStyle]} numberOfLines={1}>{currentTrack.artist?.name}</Animated.Text>
                    </Animated.View>

                    {/* MINI RIGHT CONTROLS */}
                    <Animated.View style={[styles.miniBtnAbsolute, miniControlsStyle]}>
                        <TouchableScale
                            style={styles.miniBtn}
                            onPress={() => { haptic(displayedPlaying ? 'pause' : 'resume'); togglePlayPause(); }}
                            pressOnTouchDown
                            activeScale={1}
                            accessibilityRole="button"
                            accessibilityLabel={isBuffering ? 'Loading audio' : displayedPlaying ? 'Pause' : 'Play'}
                        >
                            <View style={styles.miniPlayGlyph}>
                                {isBuffering ? (
                                    <ActivityIndicator pointerEvents="none" color={colors.textSecondary} size="small" />
                                ) : (
                                    <Ionicons name={displayedPlaying ? 'pause' : 'play'} size={30} color={colors.text} />
                                )}
                            </View>
                        </TouchableScale>
                        <TouchableScale style={styles.miniBtn} onPress={() => { haptic('skipNext'); playNext(); }} activeScale={0.86} accessibilityRole="button" accessibilityLabel="Next">
                            <Ionicons name="play-forward" size={25} color={colors.text} />
                        </TouchableScale>
                    </Animated.View>

                    {/* FULL LAYOUT CONTROLS (NowPlayingScreen / PlayerControls) */}
                    <Animated.View style={[StyleSheet.absoluteFill, { paddingTop: Math.max(insets.top, 20) }, fullControlsStyle]}>

                        {/* Grabber: 5dp shadowed bar */}
                        <TouchableOpacity
                            style={styles.dragHandleRow}
                            onPress={() => {
                                setPlayerExpanded(false);
                                dragY.value = withSpring(MINIMIZED_Y, SPRING_CONFIG);
                            }}
                            accessibilityRole="button"
                            accessibilityLabel="Minimize player"
                        >
                            <View style={styles.dragHandle} />
                        </TouchableOpacity>

                        {/* Title-row glyphs beside the morphing text: like + more */}
                        <View style={[styles.titleGlyphs, { top: FULL_INFO_Y + 10 }]}>
                            {!showLyrics && !showQueue && <CircleGlyph icon="ellipsis-horizontal" label="More" onPress={() => { haptic('tap'); songMenu({ kind: 'track', track: currentTrack }, navigation); }} big />}
                        </View>

                        <View style={[styles.deck, { top: DECK_TOP }]}>
                            {/* Current lyric strip, directly above the scrubber */}
                            <TouchableOpacity onPress={() => { haptic('tap'); toggleLyrics(); }} activeOpacity={0.7} style={styles.lyricStripRow} accessibilityRole="button" accessibilityLabel="Open lyrics">
                                {showLyrics ? (
                                    <Text style={[GX_TYPE.titleMedium, styles.lyricSource]} numberOfLines={1}>{lyricsSource ? `Lyrics by ${lyricsSource}` : 'Lyrics'}</Text>
                                ) : (
                                    <>
                                        <Text style={[GX_TYPE.titleMedium, styles.lyricStrip]} numberOfLines={1}>
                                            {lyricsLoading ? 'Looking for lyrics…' : currentLyricIndex >= 0 ? (lyrics[currentLyricIndex]?.text || '♪') : lyrics.length > 0 ? lyrics[0].text : ' '}
                                        </Text>
                                        {lyrics.length > 0 && <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.6)" />}
                                    </>
                                )}
                            </TouchableOpacity>

                            {/* Scrubber */}
                            <View style={styles.scrubRow}>
                                <VolumeSlider
                                    value={duration > 0 ? displayedTime / duration : 0}
                                    onSlide={fraction => setScrubTime(fraction * duration)}
                                    onChange={fraction => finishScrub(fraction * duration)}
                                />
                            </View>
                            <View style={styles.timeRow}>
                                <Text style={[GX_TYPE.labelMedium, styles.timeText]}>{formatTime(displayedTime)}</Text>
                                {verifiedLabel ? (
                                    <TouchableOpacity onPress={() => setShowQualityModal(true)} hitSlop={8}>
                                        <Text style={[GX_TYPE.labelSmall, styles.qualityCenter]}>{verifiedLabel.toUpperCase()}</Text>
                                    </TouchableOpacity>
                                ) : null}
                                <Text style={[GX_TYPE.labelMedium, styles.timeText]}>-{formatTime(Math.max(0, duration - displayedTime))}</Text>
                            </View>
                            {settings.statsForNerds && verifiedFormat ? (
                                <Text style={[GX_TYPE.labelSmall, styles.nerdStats]} numberOfLines={1}>
                                    {[
                                        verifiedFormat.codec?.toUpperCase(),
                                        verifiedFormat.sampleRate ? `${(verifiedFormat.sampleRate / 1000).toFixed(1)} kHz` : null,
                                        verifiedFormat.bitDepth ? `${verifiedFormat.bitDepth}-bit` : null,
                                        verifiedFormat.bitrate ? `${Math.round(verifiedFormat.bitrate / 1000)} kbps` : null,
                                        verifiedFormat.channels ? `${verifiedFormat.channels} ch` : null,
                                    ].filter(Boolean).join(' · ')}
                                </Text>
                            ) : null}

                            {/* Transport: plain white glyphs, SpaceAround */}
                            <View style={styles.transport}>
                                <TouchableScale style={styles.skipTouch} onPress={() => { haptic('skipPrevious'); playPrevious(); }} activeScale={0.86} accessibilityRole="button" accessibilityLabel="Previous">
                                    <Ionicons name="play-back" size={53} color="#FFFFFF" style={styles.skipGlyph} />
                                </TouchableScale>
                                <TouchableScale
                                    style={styles.playTouch}
                                    onPress={() => { haptic(displayedPlaying ? 'pause' : 'resume'); togglePlayPause(); }}
                                    pressOnTouchDown
                                    activeScale={0.9}
                                    accessibilityRole="button"
                                    accessibilityLabel={isBuffering ? 'Loading audio' : displayedPlaying ? 'Pause' : 'Play'}
                                >
                                    {isBuffering ? (
                                        <ActivityIndicator pointerEvents="none" color="#FFFFFF" size="large" />
                                    ) : (
                                        <Ionicons name={displayedPlaying ? 'pause' : 'play'} size={74} color="#FFFFFF" />
                                    )}
                                </TouchableScale>
                                <TouchableScale style={styles.skipTouch} onPress={() => { haptic('skipNext'); playNext(); }} activeScale={0.86} accessibilityRole="button" accessibilityLabel="Next">
                                    <Ionicons name="play-forward" size={53} color="#FFFFFF" style={styles.skipGlyph} />
                                </TouchableScale>
                            </View>

                            {/* Volume */}
                            {!settings.hideVolumeBar && (
                                <View style={styles.volumeRow}>
                                    <Ionicons name="volume-low" size={20} color="rgba(255,255,255,0.6)" style={styles.volIcon} />
                                    <VolumeSlider value={volume} onChange={setVolume} />
                                    <Ionicons name="volume-high" size={20} color="rgba(255,255,255,0.6)" style={styles.volIcon} />
                                </View>
                            )}

                            {/* Action row: lyrics glyph · output/party capsule · queue glyph */}
                            <View style={styles.actionRow}>
                                {showQueue ? (
                                    <Animated.View entering={FadeIn.duration(180).delay(120)} exiting={FadeOut.duration(120)} style={[styles.pill, styles.modePill]}>
                                        <TouchableOpacity style={[styles.pillSegment, styles.modeSegment, shuffle && styles.modeOn]} onPress={() => { haptic(shuffle ? 'toggleOff' : 'toggleOn'); toggleShuffle(); }} accessibilityRole="switch" accessibilityState={{ checked: shuffle }} accessibilityLabel="Shuffle">
                                            <Ionicons name="shuffle" size={26} color={shuffle ? '#000000' : 'rgba(255,255,255,0.6)'} />
                                        </TouchableOpacity>
                                        <View style={[styles.pillDivider, styles.modeSegment]} />
                                        <TouchableOpacity style={[styles.pillSegment, styles.modeSegment, repeatMode !== 'off' && styles.modeOn]} onPress={() => { haptic(repeatMode === 'one' ? 'toggleOff' : 'toggleOn'); cycleRepeat(); }} accessibilityRole="button" accessibilityLabel={`Repeat ${repeatMode}`}>
                                            <Ionicons name="repeat" size={26} color={repeatMode !== 'off' ? '#000000' : 'rgba(255,255,255,0.6)'} />
                                            {repeatMode === 'one' && <Text style={styles.repeatOneBadge}>1</Text>}
                                        </TouchableOpacity>
                                        <View style={[styles.pillDivider, styles.modeSegment]} />
                                        <TouchableOpacity style={[styles.pillSegment, styles.modeSegment, settings.autoplay && styles.modeOn]} onPress={() => { haptic(settings.autoplay ? 'toggleOff' : 'toggleOn'); void updateAppSettings({ autoplay: !settings.autoplay }); }} accessibilityRole="switch" accessibilityState={{ checked: settings.autoplay }} accessibilityLabel="AutoPlay">
                                            <Ionicons name="infinite" size={28} color={settings.autoplay ? '#000000' : 'rgba(255,255,255,0.6)'} />
                                        </TouchableOpacity>
                                    </Animated.View>
                                ) : (
                                    <>
                                        <Animated.View entering={FadeIn.duration(180).delay(120)} exiting={FadeOut.duration(120)}>
<TouchableScale style={[styles.bottomGlyph, showLyrics && styles.bottomGlyphActive]} onPress={() => { haptic('tap'); toggleLyrics(); }} activeScale={0.86} accessibilityRole="button" accessibilityLabel={showLyrics ? 'Close lyrics' : 'Open lyrics'}>
                                            <MaterialCommunityIcons name="comment-quote-outline" size={26} color="#FFFFFF" />
                                        </TouchableScale>
</Animated.View>
                                        <Animated.View entering={FadeIn.duration(180).delay(120)} exiting={FadeOut.duration(120)} style={styles.pill}>
                                            <TouchableOpacity style={styles.pillSegment} accessibilityRole="button" accessibilityLabel="Audio output, this phone">
                                                <MaterialCommunityIcons name="cellphone" size={24} color="#FFFFFF" />
                                            </TouchableOpacity>
                                            <View style={styles.pillDivider} />
                                            <TouchableOpacity
                                                style={styles.pillSegment}
                                                onPress={() => {
                                                    setPlayerExpanded(false);
                                                    dragY.value = withSpring(MINIMIZED_Y, SPRING_CONFIG);
                                                    navigation.navigate('Jam');
                                                }}
                                                accessibilityRole="button"
                                                accessibilityLabel="Listen together"
                                            >
                                                <MaterialCommunityIcons name="account" size={24} color="#FFFFFF" />
                                            </TouchableOpacity>
                                        </Animated.View>
                                    </>
                                )}
                                <TouchableScale style={[styles.bottomGlyph, showQueue && styles.bottomGlyphActive]} onPress={() => { haptic('tap'); toggleQueue(); }} activeScale={0.86} accessibilityRole="button" accessibilityLabel={showQueue ? 'Close queue' : `Open queue, ${upNext.length} songs`}>
                                    <Ionicons name="list" size={26} color="#FFFFFF" />
                                </TouchableScale>
                            </View>
                            <Text style={[GX_TYPE.labelMedium, styles.outputCaption]}>This phone</Text>
                        </View>
                    </Animated.View>

                    {/* LYRICS DRAWER with transparent blurred background */}
                    {(showLyrics || showQueue) && (
                        <Animated.View
                            style={[styles.lyricsDrawer, lyricsAnimStyle, { paddingTop: Math.max(insets.top, 20), bottom: height - DECK_TOP }]}
                            renderToHardwareTextureAndroid
                        >

                            <GestureDetector gesture={lyricsGesture}>
                                <Animated.View style={styles.lyricsGrabArea} collapsable={false}>
                                    <View style={styles.dragHandleRow}>
                                        <Animated.View style={[styles.dragHandle, lyricsHandleStyle]} />
                                    </View>
                                {/* collapsed header: thumb, title/artist, circle glyphs */}
                                <View style={styles.lyricsHeader}>
                                    <View style={styles.lyricsThumbSlot} />
                                    <View style={styles.lyricsHeaderCopy}>
                                        <Text style={[GX_TYPE.titleMedium, styles.lyricsHeaderTitle]} numberOfLines={1}>{currentTrack.title}</Text>
                                        <Text style={[GX_TYPE.bodyMedium, styles.lyricsHeaderArtist]} numberOfLines={1}>{currentTrack.artist?.name}</Text>
                                    </View>
                                    <CircleGlyph icon="ellipsis-horizontal" label="More" onPress={() => { haptic('tap'); songMenu({ kind: 'track', track: currentTrack }, navigation); }} big />
                                </View>
                                </Animated.View>
                            </GestureDetector>
                            {showQueue ? (
                                <View style={styles.inlineQueue}>
                                    <QueuePanel
                                        current={currentTrack}
                                        isPlaying={isPlaying}
                                        queue={queue}
                                        upNext={upNext}
                                        onJumpTo={playFromQueue}
                                        onRemove={removeFromQueue}
                                        onMove={moveInQueue}
                                        onClear={confirmClearQueue}
                                        onSkipCurrent={() => playNext()}
                                        history={settings.showQueueHistory ? history : undefined}
                                        onPlayHistory={track => playTrack(track)}
                                        onLoadMore={loadMoreUpNext}
                                    />
                                </View>
                            ) : lyricsLoading ? (
                                <View style={styles.lyricsLoader} accessibilityRole="progressbar" accessibilityLabel="Loading lyrics">
                                    <SkeletonPulse>
                                        {[78, 56, 86, 64, 72].map((lineWidth, index) => (
                                            <View key={`${lineWidth}-${index}`} style={[styles.lyricsSkeletonLine, { width: `${lineWidth}%` }]} />
                                        ))}
                                    </SkeletonPulse>
                                </View>
                            ) : lyrics.length === 0 ? (
                                <View style={styles.lyricsCentered}><MaterialIcons name="lyrics" size={48} color="rgba(255,255,255,0.3)" /><Text style={styles.lyricsEmptyText}>No lyrics available</Text></View>
                            ) : (
                                <FlatList ref={lyricsListRef} data={lyrics} renderItem={renderLyricLine} keyExtractor={(_, i) => `lyric-${i}`} showsVerticalScrollIndicator={false} contentContainerStyle={styles.lyricsListContent} />
                            )}
                        </Animated.View>
                    )}
                    </Animated.View>
                </GestureDetector>
            </Animated.View>

            {/* Quality selector drawer */}
            <DraggableBottomSheet
                visible={showQualityModal}
                onClose={() => setShowQualityModal(false)}
                sheetStyle={styles.modalSheet}
                backdropLabel="Close streaming quality drawer"
            >
                        <TouchableOpacity
                            style={styles.qualityRow}
                            onPress={handleDownload}
                            disabled={downloadState === 'downloading' || downloadState === 'done'}
                        >
                            <Ionicons name={downloadState === 'done' ? 'checkmark-circle' : 'arrow-down-circle-outline'} size={24} color="#FFFFFF" />
                            <Text style={[styles.qualityLabel, styles.menuLabel]}>
                                {downloadState === 'downloading' ? `Downloading ${Math.max(1, Math.round(downloadProgress * 100))}%` : downloadState === 'done' ? 'Downloaded' : 'Download'}
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.qualityRow} onPress={handleLike}>
                            <Ionicons name={isLiked ? 'star' : 'star-outline'} size={24} color="#FFFFFF" />
                            <Text style={[styles.qualityLabel, styles.menuLabel]}>{isLiked ? 'Remove from liked songs' : 'Add to liked songs'}</Text>
                        </TouchableOpacity>
                        <Text style={styles.modalTitle}>Streaming Quality</Text>
                        {QUALITY_OPTIONS.map((opt, i) => {
                            const isSelected = quality === opt.value;
                            return (
                                <TouchableOpacity
                                    key={i}
                                    style={[styles.qualityRow, isSelected && styles.qualityRowActive]}
                                    onPress={() => {
                                        setQuality(opt.value);
                                        setShowQualityModal(false);
                                    }}
                                >
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.qualityLabel}>{opt.label}</Text>
                                        <Text style={styles.qualityDesc}>{opt.desc}</Text>
                                    </View>
                                    {isSelected && <Ionicons name="checkmark-circle" size={22} color="#fa2d48" />}
                                </TouchableOpacity>
                            );
                        })}
                        <TouchableOpacity style={styles.modalDismiss} onPress={() => setShowQualityModal(false)}>
                            <Text style={styles.modalDismissText}>Done</Text>
                        </TouchableOpacity>
            </DraggableBottomSheet>

        </View>
    );
}

const styles = StyleSheet.create({
    absoluteContainer: {
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 100,
        pointerEvents: 'box-none', // Let touches pass through to tab bar
    },
    playerViewport: {
        position: 'absolute', top: 0, left: 0, right: 0,
        overflow: 'hidden',
    },
    widgetRoot: {
        position: 'absolute', top: 0, left: 0, right: 0,
        backgroundColor: 'transparent', overflow: 'hidden',
        borderTopLeftRadius: 16, borderTopRightRadius: 16,
    },
    scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },

    // MINI PLAYER STYLES
    miniProgressRow: { position: 'absolute', top: 0, left: 0, right: 0, height: 2, backgroundColor: 'rgba(255,255,255,0.08)' },
    miniProgressFill: { height: 2, backgroundColor: '#fa2d48' },
    miniPill: { position: 'absolute', left: 16, right: 16, top: 2, height: 56, borderRadius: 28, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.10)' },
    miniBtnAbsolute: { position: 'absolute', top: 9, right: 28, height: 40, flexDirection: 'row', alignItems: 'center', gap: 8 },
    miniBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    miniPlayGlyph: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },

    // SHARED MORPHING STYLES
    artworkAbsolute: {
        position: 'absolute', top: 0, left: 0, overflow: 'hidden',
        elevation: 0
    },
    artwork: { width: '100%', height: '100%' },
    textAbsolute: { position: 'absolute', top: 0, left: 0 },
    trackTitle: { fontFamily: 'SFProDisplay-Bold', color: '#fff', letterSpacing: -0.3 },
    trackArtist: { fontFamily: 'SFProDisplay-Medium', color: 'rgba(255,255,255,0.6)' },

    // FULL PLAYER STYLES 
    dragHandleRow: { alignItems: 'center', paddingVertical: 8 },
    dragHandle: {
        width: 38, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)',
        shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2,
    },
    titleGlyphs: { position: 'absolute', right: 32, flexDirection: 'row', gap: 10 },
    deck: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 30 },
    lyricStripRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    lyricSource: { color: 'rgba(255,255,255,0.75)', textDecorationLine: 'underline', paddingVertical: 2 },
    scrubRow: { flexDirection: 'row', height: 28 },
    volIcon: { marginHorizontal: 10 },
    bottomGlyphActive: { backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 30 },
    lyricTranslation: { color: '#FFFFFF', fontFamily: 'SFProDisplay-Medium', fontSize: 18, lineHeight: 24, marginTop: 4, opacity: 0.8 },
    nerdStats: { color: 'rgba(255,255,255,0.55)', textAlign: 'center', marginTop: 4 },
    modePill: { height: 44, borderRadius: 22, overflow: 'hidden' },
    modeSegment: { height: 44 },
    pillSegmentOn: { backgroundColor: 'rgba(255,255,255,0.10)', borderTopRightRadius: 36, borderBottomRightRadius: 36 },
    inlineQueue: { flex: 1, paddingHorizontal: 24 },
    outputCaption: { color: 'rgba(255,255,255,0.55)', textAlign: 'center', marginTop: 10 },
    queueModes: { alignSelf: 'flex-start', marginBottom: 8 },
    menuLabel: { marginLeft: 12, marginBottom: 0 },
    lyricStrip: { flexShrink: 1, color: '#FFFFFF', paddingVertical: 2 },
    skipTouch: { width: 53, height: 53, alignItems: 'center', justifyContent: 'center' },
    skipGlyph: { transform: [{ scaleY: 0.85 }] },
    playTouch: { width: 92, height: 92, alignItems: 'center', justifyContent: 'center' },
    qualityCenter: { color: 'rgba(255,255,255,0.55)', letterSpacing: 0.4 },
    actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, paddingBottom: 18 },
    bottomGlyph: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    pill: { flexDirection: 'row', alignItems: 'center', height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.14)' },
    pillSegment: { width: 64, height: 44, alignItems: 'center', justifyContent: 'center' },
    pillDivider: { width: 1, height: 44, backgroundColor: 'rgba(255,255,255,0.3)' },
    pillText: { color: '#FFFFFF' },
    repeatOneBadge: { position: 'absolute', top: 6, right: 14, fontFamily: 'SFProDisplay-Bold', fontSize: 9, color: '#000000' },
    modeOn: { backgroundColor: '#FFFFFF' },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, marginBottom: 30, paddingHorizontal: 30 },
    qualityChip: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.15)' },
    qualityChipText: { fontFamily: 'Inter-Bold', color: '#fff', fontSize: 10, letterSpacing: 0.5 },

    progressSection: { marginBottom: 4, paddingHorizontal: 30 },
    slider: { width: '100%', height: 32, marginHorizontal: -6 },
    timeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 0 },
    timeText: { color: 'rgba(255,255,255,0.55)' },
    transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', marginTop: 8, marginBottom: 12 },
    transportBtn: { padding: 12 },
    playGlyph: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    playGlyphIcon: { textAlign: 'center', textAlignVertical: 'center', includeFontPadding: false },
    playBtn: {
        width: 72, height: 72, borderRadius: 36, backgroundColor: '#fff',
        justifyContent: 'center', alignItems: 'center',
        shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
    },
    repeatOneDot: { position: 'absolute', top: -3, right: -4, minWidth: 13, height: 13, borderRadius: 7, backgroundColor: '#fa2d48', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
    repeatOneText: { color: '#fff', fontSize: 8, fontFamily: 'Inter-Bold', lineHeight: 11 },
    volumeRow: { flexDirection: 'row', alignItems: 'center', height: 32 },
    volumeSlider: { flex: 1, marginHorizontal: 10, height: 40 },
    footer: { flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 8, paddingHorizontal: 30 },
    footerBtn: { minWidth: 88, minHeight: 52, paddingHorizontal: 10, paddingVertical: 6, alignItems: 'center', justifyContent: 'center', gap: 3 },
    footerBtnLabel: { fontFamily: 'Inter-Medium', color: 'rgba(255,255,255,0.72)', fontSize: 10 },
    footerBtnLabelDone: { color: '#4CAF50' },
    footerBtnLabelError: { color: '#FF6B6B' },
    footerBtnLabelLiked: { color: '#FA2D48' },
    queueCountBadge: { position: 'absolute', top: -6, right: -10, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: '#FA2D48', alignItems: 'center', justifyContent: 'center' },
    queueCountText: { fontFamily: 'Inter-Bold', color: '#FFFFFF', fontSize: 9, lineHeight: 12 },

    // UP NEXT
    queueSheet: { height: '78%', paddingHorizontal: 18 },
    queueHeader: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
    queueTitle: { fontFamily: 'Inter-Bold', color: '#FFFFFF', fontSize: 22, lineHeight: 28 },
    queueSubtitle: { fontFamily: 'Inter-Regular', color: 'rgba(255,255,255,0.5)', fontSize: 11, lineHeight: 15, marginTop: 1 },
    clearQueueButton: { minWidth: 54, minHeight: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.07)' },
    clearQueueText: { fontFamily: 'Inter-SemiBold', color: '#FA2D48', fontSize: 12 },
    nowPlayingQueueRow: { minHeight: 70, flexDirection: 'row', alignItems: 'center', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8, backgroundColor: 'rgba(250,45,72,0.09)', borderWidth: 1, borderColor: 'rgba(250,45,72,0.2)' },
    queueListContent: { paddingBottom: 12 },
    queueRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5, paddingVertical: 6 },
    queueIndex: { width: 28, fontFamily: 'Inter-SemiBold', color: 'rgba(255,255,255,0.32)', fontSize: 10 },
    queueCover: { width: 48, height: 48, borderRadius: 10, backgroundColor: '#292A2E', marginRight: 10 },
    queueTrackCopy: { flex: 1, minWidth: 0, marginRight: 8 },
    queueEyebrow: { fontFamily: 'Inter-Bold', color: '#FA2D48', fontSize: 8, lineHeight: 11, marginBottom: 1 },
    queueTrackTitle: { fontFamily: 'Inter-SemiBold', color: '#FFFFFF', fontSize: 13, lineHeight: 17 },
    queueTrackArtist: { fontFamily: 'Inter-Regular', color: 'rgba(255,255,255,0.5)', fontSize: 10, lineHeight: 14, marginTop: 1 },
    queueRemoveButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    queueEmptyState: { flex: 1, minHeight: 220, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36 },
    queueEmptyTitle: { fontFamily: 'Inter-SemiBold', color: '#FFFFFF', fontSize: 15, marginTop: 12 },
    queueEmptySubtitle: { fontFamily: 'Inter-Regular', color: 'rgba(255,255,255,0.45)', fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 5 },
    queueSkeletonGroup: { width: '100%', marginTop: 18 },
    queueSkeletonRow: { height: 50, flexDirection: 'row', alignItems: 'center', marginBottom: 9 },
    queueSkeletonCover: { width: 46, height: 46, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.12)' },
    queueSkeletonCopy: { flex: 1, marginLeft: 11 },
    queueSkeletonTitle: { width: '62%', height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.14)' },
    queueSkeletonMeta: { width: '42%', height: 8, borderRadius: 4, marginTop: 8, backgroundColor: 'rgba(255,255,255,0.09)' },

    // LYRICS
    lyricsDrawer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'transparent', borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
    lyricsBackdrop: { opacity: 0.55 },
    lyricsGrabArea: { minHeight: 68 },
    lyricsHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginTop: 6, marginBottom: 12 },
    lyricsThumbSlot: { width: 54, height: 54 },
    lyricsHeaderCopy: { flex: 1, minWidth: 0, marginLeft: 12, marginRight: 10 },
    lyricsHeaderTitle: { color: '#FFFFFF' },
    lyricsHeaderArtist: { color: 'rgba(255,255,255,0.6)' },
    lyricsHeaderGap: { width: 10 },
    lyricsListContent: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 220 },
    lyricLineContainer: { paddingVertical: 10 },
    // 34sp heavy, left aligned, white with alpha falloff.
    lyricText: { fontFamily: 'SFProDisplay-Heavy', fontSize: 34, lineHeight: 41, color: '#FFFFFF', letterSpacing: -0.8 },
    lyricsCentered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    lyricsEmptyText: { fontFamily: 'Inter-Regular', color: 'rgba(255,255,255,0.3)', fontSize: 18, marginTop: 16 },
    lyricsLoadingText: { fontFamily: 'Inter-Regular', color: '#fff', marginTop: 16 },
    lyricsLoader: { flex: 1, justifyContent: 'center', paddingHorizontal: 32 },
    lyricsSkeletonLine: { height: 22, borderRadius: 11, marginBottom: 22, backgroundColor: 'rgba(255,255,255,0.16)' },

    // QUALITY MODAL
    modalSheet: { backgroundColor: '#1C1C1E', paddingHorizontal: 24, paddingBottom: 26 },
    modalTitle: { fontFamily: 'Inter-Bold', color: '#fff', fontSize: 20, marginBottom: 20, textAlign: 'center' },
    qualityRow: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 12, marginBottom: 8, backgroundColor: 'rgba(255,255,255,0.05)' },
    qualityRowActive: { backgroundColor: 'rgba(250,45,72,0.15)', borderWidth: 1, borderColor: 'rgba(250,45,72,0.3)' },
    qualityLabel: { fontFamily: 'Inter-SemiBold', color: '#fff', fontSize: 16, marginBottom: 2 },
    qualityDesc: { fontFamily: 'Inter-Regular', color: 'rgba(255,255,255,0.5)', fontSize: 13 },
    modalDismiss: { marginTop: 16, alignItems: 'center', padding: 14, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)' },
    modalDismissText: { fontFamily: 'Inter-SemiBold', color: '#fff', fontSize: 16 },
});
