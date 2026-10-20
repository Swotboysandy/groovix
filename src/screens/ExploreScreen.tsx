// ExploreScreen + MoodGenrePlaylistsScreen, fed by YouTube
// Music's "Moods & genres" catalogue.
import React, { useCallback, useEffect, useState } from 'react';
import { Image, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import SkeletonPulse from '../components/SkeletonPulse';
import { useScreenStatusBar } from '../hooks/useScreenStatusBar';
import GlassHeader, { BackBar, ProfileCircle } from '../components/GlassHeader';
import { moodPlaylists, moodsAndGenres, type YtMood, type YtPlaylistShelf } from '../services/ytmusic';
import { GX_DARK, GX_LIGHT, GX_TYPE, PAGE_GUTTER, SHELF_CARD_WIDTH } from '../theme/groovix';

export type MoodGenre = YtMood;

const MOOD_SPACING = 12;
const MOOD_CARD_ASPECT = 1.72;
const MOOD_STRIPE_FRACTION = 0.28;
const PLAYLIST_CARD = SHELF_CARD_WIDTH;

function mix(hex: string, target: number, amount: number): string {
    const n = parseInt(hex.slice(1), 16);
    const ch = (shift: number) => Math.round(((n >> shift) & 255) * (1 - amount) + target * amount);
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

const artworkCache = new Map<string, string>();

// MoodGenreSleeve: the mood's stripe colour, then its lead playlist's
// cover washed in the same colour.
function MoodGenreSleeve({ item, style }: { item: MoodGenre; style?: object }) {
    const [art, setArt] = useState(artworkCache.get(item.params));
    useEffect(() => {
        if (art) return;
        let live = true;
        moodPlaylists(item).then(shelves => {
            const url = shelves[0]?.items[0]?.thumbnail;
            if (!url) return;
            artworkCache.set(item.params, url);
            if (live) setArt(url);
        }).catch(() => {});
        return () => { live = false; };
    }, [art, item]);
    return (
        <View style={[styles.sleeve, { backgroundColor: mix(item.color, 0, 0.12) }, style]}>
            <View style={[styles.sleeveArt, { backgroundColor: mix(item.color, 0, 0.3) }]}>
                {art ? <Image source={{ uri: art }} style={StyleSheet.absoluteFill} /> : null}
                {/* Approximates duotone colour matrix with a tinted wash. */}
                <View style={[StyleSheet.absoluteFill, { backgroundColor: mix(item.color, 0, 0.3), opacity: 0.72 }]} />
            </View>
            <Text style={[GX_TYPE.titleMedium, styles.sleeveTitle, { fontSize: 22 }]} numberOfLines={2}>{item.title}</Text>
        </View>
    );
}

export default function ExploreScreen({ navigation }: any) {
    const { colors, theme } = useTheme();
    useScreenStatusBar(theme === 'soundwave' ? 'dark-content' : 'light-content', colors.background);
    const c = theme === 'soundwave' ? GX_LIGHT : GX_DARK;
    const { width } = useWindowDimensions();
    const columns = Math.min(6, Math.max(2, Math.floor((width - PAGE_GUTTER * 2 + MOOD_SPACING) / (220 + MOOD_SPACING))));
    const cardWidth = (width - PAGE_GUTTER * 2 - MOOD_SPACING * (columns - 1)) / columns;
    const [refreshing, setRefreshing] = useState(false);
    const [moods, setMoods] = useState<MoodGenre[]>([]);
    const [failed, setFailed] = useState(false);

    const load = useCallback(() => moodsAndGenres()
        .then(list => { setMoods(list); setFailed(false); })
        .catch(() => setFailed(true)), []);

    useEffect(() => { void load(); }, [load]);

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        load().finally(() => setRefreshing(false));
    }, [load]);

    return (
        <SafeAreaView style={[styles.root, { backgroundColor: c.background }]} edges={['top']}>
            <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.content}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.onBackground} />}
            >
                <GlassHeader />
                <Text style={[GX_TYPE.displayLarge, styles.title, { color: c.onBackground }]}>Explore</Text>
                {failed && moods.length === 0 ? (
                    <View style={styles.message}>
                        <Text style={[GX_TYPE.bodyMedium, { color: c.onSurfaceVariant }]}>Couldn't load moods and genres</Text>
                        <TouchableOpacity onPress={load} accessibilityRole="button"><Text style={[GX_TYPE.titleMedium, styles.retry, { color: c.onBackground }]}>Retry</Text></TouchableOpacity>
                    </View>
                ) : moods.length === 0 ? (
                    <SkeletonPulse>
                        <View style={styles.grid}>
                            {Array.from({ length: 10 }, (_, i) => (
                                <View key={i} style={[styles.sleeve, { width: cardWidth, height: cardWidth / MOOD_CARD_ASPECT, backgroundColor: c.surfaceVariant }]} />
                            ))}
                        </View>
                    </SkeletonPulse>
                ) : (
                    <View style={styles.grid}>
                        {moods.map(item => (
                            <TouchableOpacity
                                key={item.params}
                                activeOpacity={0.85}
                                onPress={() => navigation.navigate('MoodGenre', { mood: item })}
                                accessibilityRole="button"
                                accessibilityLabel={item.title}
                            >
                                <MoodGenreSleeve item={item} style={{ width: cardWidth, height: cardWidth / MOOD_CARD_ASPECT }} />
                            </TouchableOpacity>
                        ))}
                    </View>
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

export function MoodGenrePlaylistsScreen({ navigation, route }: any) {
    const mood: MoodGenre = route?.params?.mood;
    const { theme } = useTheme();
    const c = theme === 'soundwave' ? GX_LIGHT : GX_DARK;
    const [shelves, setShelves] = useState<YtPlaylistShelf[]>([]);
    const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');

    const load = useCallback(async () => {
        setState('loading');
        try {
            setShelves(await moodPlaylists(mood));
            setState('ready');
        } catch {
            setState('error');
        }
    }, [mood]);

    useEffect(() => { void load(); }, [load]);

    // "Playlist • YouTube Music" reads "playlist • YouTube Music" in Groovix.
    const subtitle = (text: string) => (text ? text.charAt(0).toLowerCase() + text.slice(1) : '');

    return (
        <SafeAreaView style={[styles.root, { backgroundColor: c.background }]} edges={['top']}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
                <BackBar right={<ProfileCircle />} />
                <Text style={[GX_TYPE.displayLarge, styles.detailTitle, { color: c.onBackground }]} numberOfLines={1}>{mood.title}</Text>
                {state === 'loading' ? (
                    <SkeletonPulse>
                        {[0, 1, 2].map(row => (
                            <View key={row} style={styles.shelf}>
                                <View style={[styles.skeletonHeader, { backgroundColor: c.surfaceVariant }]} />
                                <View style={styles.shelfRow}>
                                    {[0, 1, 2].map(i => <View key={i} style={[styles.shelfArt, { borderWidth: 0, backgroundColor: c.surfaceVariant }]} />)}
                                </View>
                            </View>
                        ))}
                    </SkeletonPulse>
                ) : state === 'error' ? (
                    <View style={styles.message}>
                        <Text style={[GX_TYPE.bodyMedium, { color: c.onSurfaceVariant }]}>Couldn't load {mood.title}</Text>
                        <TouchableOpacity onPress={load} accessibilityRole="button"><Text style={[GX_TYPE.titleMedium, styles.retry, { color: c.onBackground }]}>Retry</Text></TouchableOpacity>
                    </View>
                ) : shelves.map(shelf => (
                    <View key={shelf.title} style={styles.shelf}>
                        <Text style={[GX_TYPE.titleLarge, styles.sectionHeader, { color: c.onBackground, fontFamily: 'SFProDisplay-Semibold' }]}>{shelf.title}</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelfRow}>
                            {shelf.items.map(item => (
                                <TouchableOpacity
                                    key={item.browseId}
                                    style={styles.shelfCard}
                                    onPress={() => navigation.navigate('AlbumDetail', { ytPlaylistId: item.browseId, ytPlaylistData: item })}
                                    activeOpacity={0.85}
                                    accessibilityRole="button"
                                    accessibilityLabel={item.title}
                                >
                                    <Image source={{ uri: item.thumbnail }} style={[styles.shelfArt, { backgroundColor: c.surfaceVariant, borderColor: c.thumbnailBorder }]} />
                                    <Text style={[GX_TYPE.titleMedium, styles.shelfTitle, { color: c.onBackground }]} numberOfLines={1}>{item.title}</Text>
                                    <Text style={[GX_TYPE.bodyMedium, { color: c.onSurfaceVariant }]} numberOfLines={1}>{subtitle(item.subtitle)}</Text>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                    </View>
                ))}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    content: { paddingBottom: 160 },
    title: { paddingHorizontal: PAGE_GUTTER, paddingTop: 6, paddingBottom: 14 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: PAGE_GUTTER, gap: MOOD_SPACING },
    sleeve: { borderRadius: 18, overflow: 'hidden' },
    sleeveArt: { position: 'absolute', top: 0, bottom: 0, right: 0, width: `${(1 - MOOD_STRIPE_FRACTION) * 100}%`, overflow: 'hidden' },
    sleeveTitle: {
        color: '#FFFFFF', fontFamily: 'SFProDisplay-Bold', paddingHorizontal: 14, paddingVertical: 12,
        textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
    },
    detailTitle: { paddingHorizontal: PAGE_GUTTER, paddingVertical: 8 },
    shelf: { paddingBottom: 26 },
    sectionHeader: { paddingHorizontal: PAGE_GUTTER, paddingTop: 4, paddingBottom: 12 },
    shelfRow: { paddingHorizontal: PAGE_GUTTER, gap: 14, flexDirection: 'row' },
    shelfCard: { width: PLAYLIST_CARD },
    shelfArt: { width: PLAYLIST_CARD, height: PLAYLIST_CARD, borderRadius: 14, borderWidth: 1 },
    shelfTitle: { marginTop: 10, marginBottom: -2 },
    skeletonHeader: { width: 160, height: 22, borderRadius: 6, marginHorizontal: PAGE_GUTTER, marginVertical: 14 },
    message: { alignItems: 'center', padding: 32 },
    retry: { marginTop: 10 },
});
