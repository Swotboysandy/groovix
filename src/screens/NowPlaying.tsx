import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, Image,
    ActivityIndicator, Dimensions, FlatList,
    StatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
    useSharedValue, useAnimatedStyle, withSpring, withTiming,
    runOnJS, interpolate, Extrapolation, cancelAnimation, Easing,
} from 'react-native-reanimated';
import Ionicons from 'react-native-vector-icons/Ionicons';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import Slider from '@react-native-community/slider';
import TouchableScale from '../components/TouchableScale';
import DraggableBottomSheet from '../components/DraggableBottomSheet';
import SkeletonPulse from '../components/SkeletonPulse';
import { API, LyricLine } from '../api';
import { COLORS } from '../theme';
import { usePlayer, StreamQuality, formatVerifiedQuality } from '../context/PlayerContext';
import { useAppDialog } from '../context/DialogContext';
import { downloadTrackForOffline } from '../services/downloads';
import { getPrefs } from '../store/preferences';

const { width, height } = Dimensions.get('window');
const ARTWORK_SIZE = width - 64;
const DISMISS_THRESHOLD = 120;
const VELOCITY_THRESHOLD = 800;

const SPRING_CONFIG = { damping: 30, stiffness: 390, mass: 0.82, overshootClamping: true };

const QUALITY_OPTIONS: { label: string; desc: string; value: StreamQuality }[] = [
    { label: 'Hi-Res', desc: '24-bit FLAC up to 192 kHz', value: 'HI_RES_LOSSLESS' },
    { label: 'Lossless', desc: '16-bit / 44.1 kHz FLAC', value: 'LOSSLESS' },
    { label: 'High', desc: '320 kbps AAC', value: 'HIGH' },
    { label: 'Low', desc: '96 kbps AAC', value: 'LOW' }
];

const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
};

export default function NowPlayingScreen({ route, navigation }: any) {
    const {
        currentTrack, isPlaying, isBuffering, currentTime, duration,
        volume, quality, togglePlayPause, seek, setVolume, setQuality, playTrack,
        verifiedFormat, lucidaProgress, usingFallback,
    } = usePlayer();
    const { showDialog } = useAppDialog();

    const routeTrack = route?.params?.track;
    const trackRef = useRef<number | null>(null);
    const displayedPlaying = isPlaying;

    useEffect(() => {
        if (routeTrack && routeTrack.id !== trackRef.current) {
            trackRef.current = routeTrack.id;
            if (!currentTrack || currentTrack.id !== routeTrack.id) {
                playTrack(routeTrack);
            }
        }
    }, [routeTrack?.id]);

    const track = currentTrack || routeTrack;
    if (!track) {
        navigation.goBack();
        return null;
    }

    const [isDownloading, setIsDownloading] = useState(false);
    const [scrubTime, setScrubTime] = useState<number | null>(null);
    const displayedTime = scrubTime ?? currentTime;
    const [elapsedSec, setElapsedSec] = useState(0);
    useEffect(() => {
        if (!lucidaProgress) { setElapsedSec(0); return; }
        const tick = () => setElapsedSec(Math.max(0, Math.round((Date.now() - lucidaProgress.startedAt) / 1000)));
        tick();
        const iv = setInterval(tick, 1000);
        return () => clearInterval(iv);
    }, [lucidaProgress?.startedAt]);
    const [showQualityModal, setShowQualityModal] = useState(false);
    const [showLyrics, setShowLyrics] = useState(false);
    const [availableTags, setAvailableTags] = useState<string[]>([]);

    // Native lyrics
    const [lyrics, setLyrics] = useState<LyricLine[]>([]);
    const [lyricsLoading, setLyricsLoading] = useState(false);
    const lyricsListRef = useRef<FlatList>(null);
    const lastScrolledIndex = useRef(-1);

    // --- Reanimated shared values ---
    // Player dismiss gesture
    const playerTranslateY = useSharedValue(0);
    const playerContext = useSharedValue(0);

    // Lyrics drawer gesture
    const lyricsTranslateY = useSharedValue(height);
    const lyricsContext = useSharedValue(height);

    const goBack = useCallback(() => navigation.goBack(), [navigation]);

    // Player dismiss gesture (drag down to close)
    const playerGesture = Gesture.Pan()
        .onStart(() => {
            'worklet';
            cancelAnimation(playerTranslateY);
            playerContext.value = playerTranslateY.value;
        })
        .onUpdate((e) => {
            'worklet';
            // Only allow dragging down
            const newVal = playerContext.value + e.translationY;
            playerTranslateY.value = Math.max(0, newVal);
        })
        .onEnd((e) => {
            'worklet';
            const projectedY = playerTranslateY.value + Math.max(0, e.velocityY) * 0.16;
            if (projectedY > DISMISS_THRESHOLD || e.velocityY > VELOCITY_THRESHOLD) {
                playerTranslateY.value = withTiming(height, { duration: 180, easing: Easing.out(Easing.cubic) }, () => {
                    runOnJS(goBack)();
                });
            } else {
                playerTranslateY.value = withSpring(0, SPRING_CONFIG);
            }
        })
        .activeOffsetY(10)
        .failOffsetX([-20, 20]);

    const playerAnimStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: playerTranslateY.value }],
        borderTopLeftRadius: interpolate(playerTranslateY.value, [0, 40], [0, 16], Extrapolation.CLAMP),
        borderTopRightRadius: interpolate(playerTranslateY.value, [0, 40], [0, 16], Extrapolation.CLAMP),
    }));

    // Lyrics drawer gesture (drag down to close)
    const openLyrics = useCallback(() => {
        setShowLyrics(true);
        cancelAnimation(lyricsTranslateY);
        lyricsTranslateY.value = withSpring(0, SPRING_CONFIG);
    }, [lyricsTranslateY]);

    const closeLyrics = useCallback(() => {
        cancelAnimation(lyricsTranslateY);
        lyricsTranslateY.value = withTiming(height, { duration: 180, easing: Easing.out(Easing.cubic) }, () => {
            runOnJS(setShowLyrics)(false);
        });
    }, [lyricsTranslateY]);

    const toggleLyrics = useCallback(() => {
        if (showLyrics) closeLyrics();
        else openLyrics();
    }, [showLyrics]);

    const lyricsGesture = Gesture.Pan()
        .onStart(() => {
            'worklet';
            cancelAnimation(lyricsTranslateY);
            lyricsContext.value = lyricsTranslateY.value;
        })
        .onUpdate((e) => {
            'worklet';
            const next = lyricsContext.value + e.translationY;
            lyricsTranslateY.value = next < 0 ? next * 0.06 : Math.min(height, next);
        })
        .onEnd((e) => {
            'worklet';
            const projectedY = Math.max(0, lyricsTranslateY.value) + Math.max(0, e.velocityY) * 0.16;
            if (projectedY > DISMISS_THRESHOLD || e.velocityY > VELOCITY_THRESHOLD) {
                lyricsTranslateY.value = withTiming(height, { duration: 180, easing: Easing.out(Easing.cubic) }, () => {
                    runOnJS(setShowLyrics)(false);
                });
            } else {
                lyricsTranslateY.value = withSpring(0, SPRING_CONFIG);
            }
        })
        .activeOffsetY(10)
        .failOffsetX([-20, 20]);

    const lyricsAnimStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: lyricsTranslateY.value }],
    }));

    // Fetch track info
    useEffect(() => {
        API.getTrackInfo(track.id).then(info => setAvailableTags(info.tags));
    }, [track.id]);

    // Fetch lyrics
    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLyricsLoading(true);
            setLyrics([]);
            try {
                const data = await API.getLyrics(
                    track.title, track.artist?.name || '',
                    track.album?.title || '', track.duration || 0,
                );
                if (!cancelled) setLyrics(data);
            } catch (e) { console.log('Lyrics error:', e); }
            finally { if (!cancelled) setLyricsLoading(false); }
        })();
        return () => { cancelled = true; };
    }, [track.id]);

    // Current lyric line
    const currentLyricIndex = useMemo(() => {
        if (lyrics.length === 0) return -1;
        const hasTiming = lyrics.some(l => l.time >= 0);
        if (!hasTiming) return -1;
        for (let i = lyrics.length - 1; i >= 0; i--) {
            if (lyrics[i].time >= 0 && currentTime >= lyrics[i].time) return i;
        }
        return -1;
    }, [currentTime, lyrics]);

    // Auto-scroll lyrics
    useEffect(() => {
        if (currentLyricIndex >= 0 && showLyrics && currentLyricIndex !== lastScrolledIndex.current) {
            lastScrolledIndex.current = currentLyricIndex;
            try {
                lyricsListRef.current?.scrollToIndex({
                    index: currentLyricIndex, animated: true, viewPosition: 0.35,
                });
            } catch (e) { }
        }
    }, [currentLyricIndex, showLyrics]);

    const isQualityAvailable = (q: StreamQuality): boolean => {
        if (availableTags.length === 0) return true;
        const tagMap: Record<StreamQuality, string[]> = {
            'HI_RES_LOSSLESS': ['HIRES_LOSSLESS', 'HI_RES_LOSSLESS', 'HI_RES'],
            'LOSSLESS': ['LOSSLESS', 'HIRES_LOSSLESS', 'HI_RES_LOSSLESS'],
            'HIGH': ['LOSSLESS', 'HIRES_LOSSLESS', 'HI_RES_LOSSLESS', 'HIGH'],
            'LOW': ['LOSSLESS', 'HIRES_LOSSLESS', 'HI_RES_LOSSLESS', 'HIGH', 'LOW'],
        };
        return availableTags.some(t => tagMap[q].includes(t.toUpperCase()));
    };

    const handleSeek = (value: number) => {
        seek(value);
        setScrubTime(null);
    };

    const handleDownload = async () => {
        if (!track) return;
        setIsDownloading(true);
        try {
            const prefs = await getPrefs();
            const result = await downloadTrackForOffline(track, prefs?.downloadQuality ?? quality);
            const mb = (result.bytes / (1024 * 1024)).toFixed(1);
            showDialog({ title: 'Downloaded', message: `Saved for offline playback • ${mb} MB`, icon: 'checkmark-circle-outline' });
        } catch { showDialog({ title: 'Download failed', icon: 'cloud-offline-outline' }); }
        finally { setIsDownloading(false); }
    };

    // Only ever show the REAL, ffprobe-verified format of what's actually playing. While
    // it's still being fetched/probed (verifiedFormat null) we show a neutral "Analyzing…"
    // rather than the *requested* quality, so the badge never claims a quality we haven't
    // confirmed is playing.
    const verifiedLabel = formatVerifiedQuality(verifiedFormat);
    const canVerify = track?.source === 'lucida' && track?.provider !== 'tidal' && !usingFallback;
    const qualityBadge = verifiedLabel || (isBuffering || lucidaProgress ? 'Analyzing…' : (canVerify ? '—' : 'Unverified'));

    const renderLyricLine = useCallback(({ item, index }: { item: LyricLine; index: number }) => {
        const isActive = index === currentLyricIndex;
        const hasTiming = item.time >= 0;
        return (
            <View style={styles.lyricLineContainer}>
                <Text style={[
                    styles.lyricText,
                    isActive && hasTiming && styles.lyricTextActive,
                    !isActive && hasTiming && styles.lyricTextInactive,
                    !hasTiming && styles.lyricTextUnsynced,
                ]}>
                    {item.text}
                </Text>
            </View>
        );
    }, [currentLyricIndex]);

    return (
        <View style={styles.root}>
            <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

            {/* ====== PLAYER SHEET (draggable down to dismiss) ====== */}
            <GestureDetector gesture={playerGesture}>
                <Animated.View style={[styles.playerSheet, playerAnimStyle]}>
                    {/* Background */}
                    <Image
                        source={{ uri: API.getCoverUrl(track.album?.cover, 1280) }}
                        style={styles.bgImage}
                        blurRadius={80}
                    />
                    <View style={styles.bgOverlay} />

                    <SafeAreaView style={styles.container}>
                        {/* Drag Handle */}
                        <View style={styles.dragHandleRow}>
                            <View style={styles.dragHandle} />
                        </View>

                        {/* Header */}
                        <View style={styles.header}>
                            <TouchableScale onPress={goBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                                <Ionicons name="chevron-down" size={28} color="#fff" />
                            </TouchableScale>
                            <TouchableScale onPress={() => setShowQualityModal(true)}>
                                <View style={styles.qualityChip}>
                                    <Text style={styles.qualityChipText}>{qualityBadge.toUpperCase()}</Text>
                                </View>
                            </TouchableScale>
                            <TouchableScale hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                                <Ionicons name="ellipsis-horizontal" size={24} color="#fff" />
                            </TouchableScale>
                        </View>

                        {/* Album Art */}
                        <View style={styles.artworkContainer}>
                            <Image
                                source={{ uri: API.getCoverUrl(track.album?.cover, 640) }}
                                style={[styles.artwork, isPlaying && styles.artworkPlaying]}
                            />
                        </View>

                        {/* Track Info */}
                        <View style={styles.trackInfo}>
                            <Text style={styles.trackTitle} numberOfLines={1}>{track.title}</Text>
                            <Text style={styles.trackArtist} numberOfLines={1}>{track.artist?.name}</Text>
                            {lucidaProgress && (
                                <Text style={styles.hqStatusText}>
                                    {lucidaProgress.totalBytes
                                        ? `Fetching Hi-Res… ${Math.min(99, Math.round((lucidaProgress.bytesWritten / lucidaProgress.totalBytes) * 100))}%`
                                        : `Fetching Hi-Res… ${elapsedSec}s`}
                                </Text>
                            )}
                            {usingFallback && (
                                <Text style={styles.hqStatusText}>Source was slow — playing standard quality instead</Text>
                            )}
                        </View>

                        {/* Progress */}
                        <View style={styles.progressSection}>
                            <Slider
                                style={styles.slider}
                                minimumValue={0}
                                maximumValue={duration > 0 ? duration : 100}
                                value={displayedTime}
                                onSlidingStart={setScrubTime}
                                onValueChange={setScrubTime}
                                onSlidingComplete={handleSeek}
                                minimumTrackTintColor="#fff"
                                maximumTrackTintColor="rgba(255,255,255,0.2)"
                                thumbTintColor="#fff"
                            />
                            <View style={styles.timeRow}>
                                <Text style={styles.timeText}>{formatTime(displayedTime)}</Text>
                                <Text style={styles.timeText}>-{formatTime(Math.max(0, duration - displayedTime))}</Text>
                            </View>
                        </View>

                        {/* Transport */}
                        <View style={styles.transport}>
                            <TouchableScale style={styles.transportBtn}>
                                <Ionicons name="play-skip-back" size={32} color="#fff" />
                            </TouchableScale>
                            <TouchableScale
                                style={styles.playBtn}
                                onPress={togglePlayPause}
                                pressOnTouchDown
                                activeScale={1}
                                accessibilityRole="button"
                                accessibilityLabel={isBuffering ? 'Loading audio' : displayedPlaying ? 'Pause' : 'Play'}
                            >
                                {isBuffering ? (
                                    <ActivityIndicator pointerEvents="none" color="#fff" size="large" />
                                ) : (
                                    <Ionicons name={displayedPlaying ? 'pause' : 'play'} size={38} color="#fff" />
                                )}
                            </TouchableScale>
                            <TouchableScale style={styles.transportBtn}>
                                <Ionicons name="play-skip-forward" size={32} color="#fff" />
                            </TouchableScale>
                        </View>

                        {/* Volume */}
                        <View style={styles.volumeRow}>
                            <Ionicons name="volume-low" size={16} color="rgba(255,255,255,0.5)" />
                            <Slider
                                style={styles.volumeSlider}
                                minimumValue={0}
                                maximumValue={1}
                                value={volume}
                                onValueChange={setVolume}
                                minimumTrackTintColor="rgba(255,255,255,0.5)"
                                maximumTrackTintColor="rgba(255,255,255,0.15)"
                                thumbTintColor="rgba(255,255,255,0.8)"
                            />
                            <Ionicons name="volume-high" size={16} color="rgba(255,255,255,0.5)" />
                        </View>

                        {/* Footer */}
                        <View style={styles.footer}>
                            <TouchableScale onPress={toggleLyrics} style={styles.footerBtn}>
                                <MaterialIcons name="lyrics" size={22} color={showLyrics ? '#fa2d48' : 'rgba(255,255,255,0.6)'} />
                            </TouchableScale>
                            <TouchableScale onPress={handleDownload} style={styles.footerBtn} disabled={isDownloading}>
                                {isDownloading ? (
                                    <ActivityIndicator size="small" color="rgba(255,255,255,0.6)" />
                                ) : (
                                    <Ionicons name="download-outline" size={22} color="rgba(255,255,255,0.6)" />
                                )}
                            </TouchableScale>
                            <TouchableScale style={styles.footerBtn}>
                                <Ionicons name="heart-outline" size={22} color="rgba(255,255,255,0.6)" />
                            </TouchableScale>
                        </View>
                    </SafeAreaView>
                </Animated.View>
            </GestureDetector>

            {/* ====== LYRICS DRAWER (draggable down to close) ====== */}
            {showLyrics && (
                <GestureDetector gesture={lyricsGesture}>
                    <Animated.View style={[styles.lyricsDrawer, lyricsAnimStyle]}>
                        <Image
                            source={{ uri: API.getCoverUrl(track.album?.cover, 1280) }}
                            style={styles.bgImage}
                            blurRadius={100}
                        />
                        <View style={styles.lyricsBgOverlay} />

                        <SafeAreaView style={styles.lyricsInner}>
                            {/* Lyrics drag handle */}
                            <View style={styles.dragHandleRow}>
                                <View style={styles.dragHandle} />
                            </View>

                            {/* Lyrics Header */}
                            <View style={styles.lyricsHeader}>
                                <View style={styles.lyricsTrackRow}>
                                    <Image
                                        source={{ uri: API.getCoverUrl(track.album?.cover, 160) }}
                                        style={styles.lyricsThumb}
                                    />
                                    <View style={styles.lyricsTrackMeta}>
                                        <Text style={styles.lyricsTrackTitle} numberOfLines={1}>{track.title}</Text>
                                        <Text style={styles.lyricsTrackArtist} numberOfLines={1}>{track.artist?.name}</Text>
                                    </View>
                                </View>
                                <TouchableOpacity onPress={closeLyrics} style={styles.lyricsCloseBtn}>
                                    <Ionicons name="chevron-down" size={28} color="#fff" />
                                </TouchableOpacity>
                            </View>

                            {/* Lyrics Content */}
                            <View style={styles.lyricsContentContainer}>
                                {lyricsLoading ? (
                                    <View style={styles.lyricsLoader} accessibilityRole="progressbar" accessibilityLabel="Loading lyrics">
                                        <SkeletonPulse>
                                            {[78, 56, 86, 64, 72].map((lineWidth, index) => (
                                                <View key={`${lineWidth}-${index}`} style={[styles.lyricsSkeletonLine, { width: `${lineWidth}%` }]} />
                                            ))}
                                        </SkeletonPulse>
                                    </View>
                                ) : lyrics.length === 0 ? (
                                    <View style={styles.lyricsCentered}>
                                        <MaterialIcons name="lyrics" size={48} color="rgba(255,255,255,0.3)" />
                                        <Text style={styles.lyricsEmptyText}>No lyrics available</Text>
                                    </View>
                                ) : (
                                    <FlatList
                                        ref={lyricsListRef}
                                        data={lyrics}
                                        renderItem={renderLyricLine}
                                        keyExtractor={(_, i) => `lyric-${i}`}
                                        showsVerticalScrollIndicator={false}
                                        contentContainerStyle={styles.lyricsListContent}
                                        onScrollToIndexFailed={(info) => {
                                            setTimeout(() => {
                                                try {
                                                    lyricsListRef.current?.scrollToIndex({
                                                        index: info.index, animated: true, viewPosition: 0.35,
                                                    });
                                                } catch (e) { }
                                            }, 200);
                                        }}
                                    />
                                )}
                            </View>

                            {/* Mini controls */}
                            <View style={styles.lyricsMiniProgress}>
                                <TouchableScale onPress={togglePlayPause} pressOnTouchDown activeScale={1} style={{ marginRight: 8 }}>
                                    <Ionicons name={isPlaying ? 'pause' : 'play'} size={28} color="#fff" />
                                </TouchableScale>
                                <Slider
                                    style={{ flex: 1, height: 20 }}
                                    minimumValue={0}
                                    maximumValue={duration > 0 ? duration : 100}
                                    value={displayedTime}
                                    onSlidingStart={setScrubTime}
                                    onValueChange={setScrubTime}
                                    onSlidingComplete={handleSeek}
                                    minimumTrackTintColor="#fff"
                                    maximumTrackTintColor="rgba(255,255,255,0.2)"
                                    thumbTintColor="#fff"
                                />
                                <Text style={styles.lyricsMiniTime}>{formatTime(displayedTime)}</Text>
                            </View>
                        </SafeAreaView>
                    </Animated.View>
                </GestureDetector>
            )}

            {/* Quality drawer */}
            <DraggableBottomSheet
                visible={showQualityModal}
                onClose={() => setShowQualityModal(false)}
                sheetStyle={styles.modalSheet}
                backdropLabel="Close streaming quality drawer"
            >
                        <Text style={styles.modalSectionTitle}>Streaming Quality</Text>
                        {QUALITY_OPTIONS.map((opt, i) => {
                            const isSelected = quality === opt.value;
                            const available = isQualityAvailable(opt.value);
                            return (
                                <TouchableOpacity
                                    key={i}
                                    style={[
                                        styles.qualityRow,
                                        isSelected && styles.qualityRowActive,
                                        !available && { opacity: 0.3 },
                                    ]}
                                    disabled={!available}
                                    onPress={() => {
                                        setQuality(opt.value);
                                        setShowQualityModal(false);
                                    }}
                                >
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.qualityLabel}>{opt.label}</Text>
                                        <Text style={styles.qualityDesc}>
                                            {available ? opt.desc : 'Not available'}
                                        </Text>
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
    root: {
        flex: 1,
        backgroundColor: 'transparent',
    },
    playerSheet: {
        flex: 1,
        overflow: 'hidden',
    },
    dragHandleRow: {
        alignItems: 'center',
        paddingVertical: 6,
    },
    dragHandle: {
        width: 36,
        height: 5,
        borderRadius: 3,
        backgroundColor: 'rgba(255,255,255,0.35)',
    },
    bgImage: {
        ...StyleSheet.absoluteFillObject,
        width: '100%',
        height: '100%',
    },
    bgOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.55)',
    },
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 24,
        paddingTop: 0,
        paddingBottom: 4,
    },
    qualityChip: {
        backgroundColor: 'rgba(255,255,255,0.12)',
        paddingHorizontal: 14,
        paddingVertical: 5,
        borderRadius: 20,
    },
    qualityChipText: {
        color: '#fff',
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 1,
    },
    artworkContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 16,
        paddingBottom: 24,
    },
    artwork: {
        width: ARTWORK_SIZE,
        height: ARTWORK_SIZE,
        borderRadius: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 0.5,
        shadowRadius: 24,
        elevation: 20,
    },
    artworkPlaying: {
        shadowOpacity: 0.7,
        shadowRadius: 32,
    },
    trackInfo: {
        paddingHorizontal: 32,
        marginBottom: 8,
    },
    trackTitle: {
        color: '#fff',
        fontSize: 22,
        fontWeight: '700',
        letterSpacing: 0.3,
    },
    trackArtist: {
        color: 'rgba(255,255,255,0.6)',
        fontSize: 20,
        fontWeight: '500',
        marginTop: 2,
    },
    hqStatusText: {
        color: COLORS.primary,
        fontSize: 13,
        fontWeight: '600',
        marginTop: 6,
    },
    progressSection: {
        paddingHorizontal: 24,
        marginBottom: 4,
    },
    slider: {
        width: '100%',
        height: 28,
    },
    timeRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 4,
    },
    timeText: {
        color: 'rgba(255,255,255,0.5)',
        fontSize: 12,
        fontWeight: '500',
        fontVariant: ['tabular-nums'],
    },
    transport: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 48,
        paddingVertical: 8,
    },
    transportBtn: { padding: 8 },
    playBtn: {
        width: 70,
        height: 70,
        borderRadius: 35,
        alignItems: 'center',
        justifyContent: 'center',
    },
    volumeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 32,
        gap: 8,
        marginTop: 4,
    },
    volumeSlider: { flex: 1, height: 20 },
    footer: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 48,
        paddingVertical: 16,
        marginTop: 'auto',
    },
    footerBtn: { padding: 8 },

    // Lyrics Drawer
    lyricsDrawer: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 100,
    },
    lyricsBgOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.65)',
    },
    lyricsInner: { flex: 1 },
    lyricsHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingBottom: 12,
    },
    lyricsTrackRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    lyricsThumb: {
        width: 44,
        height: 44,
        borderRadius: 6,
        marginRight: 12,
    },
    lyricsTrackMeta: { flex: 1 },
    lyricsTrackTitle: {
        color: '#fff',
        fontSize: 15,
        fontWeight: '700',
    },
    lyricsTrackArtist: {
        color: 'rgba(255,255,255,0.6)',
        fontSize: 13,
    },
    lyricsCloseBtn: { padding: 8 },
    lyricsContentContainer: { flex: 1 },
    lyricsListContent: {
        paddingHorizontal: 24,
        paddingTop: height * 0.12,
        paddingBottom: height * 0.3,
    },
    lyricsCentered: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    lyricsLoadingText: {
        color: 'rgba(255,255,255,0.5)',
        fontSize: 14,
        marginTop: 12,
    },
    lyricsLoader: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
    lyricsSkeletonLine: { height: 22, borderRadius: 11, marginBottom: 22, backgroundColor: 'rgba(255,255,255,0.16)' },
    lyricsEmptyText: {
        color: 'rgba(255,255,255,0.4)',
        fontSize: 16,
        marginTop: 12,
    },
    lyricLineContainer: { paddingVertical: 8 },
    lyricText: {
        fontSize: 26,
        fontWeight: '700',
        lineHeight: 34,
        color: 'rgba(255,255,255,0.3)',
    },
    lyricTextActive: {
        color: '#fff',
        fontSize: 28,
    },
    lyricTextInactive: {
        color: 'rgba(255,255,255,0.25)',
    },
    lyricTextUnsynced: {
        color: 'rgba(255,255,255,0.7)',
        fontSize: 22,
        fontWeight: '600',
    },
    lyricsMiniProgress: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingBottom: 12,
        gap: 8,
    },
    lyricsMiniTime: {
        color: 'rgba(255,255,255,0.6)',
        fontSize: 12,
        fontWeight: '500',
        fontVariant: ['tabular-nums'],
        minWidth: 36,
    },

    // Modals
    modalSheet: {
        backgroundColor: '#1c1c1e',
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        paddingBottom: 40,
        paddingTop: 12,
        paddingHorizontal: 20,
    },
    modalSectionTitle: {
        color: 'rgba(255,255,255,0.5)',
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        marginBottom: 16,
    },
    qualityRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: 10,
        marginBottom: 6,
    },
    qualityRowActive: {
        backgroundColor: 'rgba(250, 45, 72, 0.1)',
    },
    qualityLabel: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    qualityDesc: {
        color: 'rgba(255,255,255,0.45)',
        fontSize: 13,
        marginTop: 2,
    },
    modalDismiss: {
        alignItems: 'center',
        paddingVertical: 14,
        marginTop: 8,
        backgroundColor: 'rgba(255,255,255,0.08)',
        borderRadius: 12,
    },
    modalDismissText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
});
