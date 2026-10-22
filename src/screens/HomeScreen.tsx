import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, { FadeIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { API } from '../api';
import TouchableScale from '../components/TouchableScale';
import SkeletonPulse from '../components/SkeletonPulse';
import { usePlayerSummary } from '../context/PlayerContext';
import { useTheme } from '../context/ThemeContext';
import { getListeningProfile } from '../store/listeningProfile';
import { getUserProfile } from '../store/userProfile';
import { appSettings } from '../store/appSettings';
import { useFocusEffect } from '@react-navigation/native';
import type { Album, Track } from '../types';
import { useScreenStatusBar } from '../hooks/useScreenStatusBar';
import { ProfileCircle } from '../components/GlassHeader';
import { useSongMenu } from '../components/SongMenu';
import { currentYouTubeUser, likedTracks, subscribedArtists } from '../services/youtubeAccount';
import { ACCENT_RED, GX_DARK, GX_LIGHT, GX_TYPE, HERO_CARD_RATIO, PAGE_GUTTER, PLAYING_ACCENT, SHELF_CARD_WIDTH, heroCardWidth, trackColumnWidth } from '../theme/groovix';
import { HOME_SUPPLEMENT_BROWSE_IDS, home, homeSupplement, mapConcurrent, moreHome, youtubeAlbum, youtubeTrack, type YtShelf } from '../services/ytmusic';

/** A YouTube Music Home shelf once its items are matched to playable songs/albums. */
type Shelf = { key: string; title: string; tracks?: Track[]; albums?: Album[] };

const SHELF_ITEMS = 16;
/** The last Home that loaded, painted instantly on the next launch while it refreshes. */
const HOME_CACHE_KEY = 'groovix:home-cache-v1';
const MIN_SHELF_ITEMS = 4;

function uniqueTracks(tracks: Track[]): Track[] {
    const seen = new Set<number>();
    return tracks.filter(track => seen.has(track.id) ? false : (seen.add(track.id), true));
}

function cover(track: Track, size: number): string {
    return API.getCoverUrl(track.album?.cover, size);
}

/**
 * A YouTube shelf as it comes, the way BitChord paints Home: nothing is matched
 * up front, each song is matched to its playable recording when it plays.
 */
async function resolveShelf(shelf: YtShelf, key: string): Promise<Shelf | null> {
    if (shelf.kind === 'songs') {
        const tracks = uniqueTracks(shelf.items.slice(0, SHELF_ITEMS).map(youtubeTrack));
        return tracks.length >= MIN_SHELF_ITEMS ? { key, title: shelf.title, tracks } : null;
    }
    const albums = shelf.items.slice(0, SHELF_ITEMS).map(youtubeAlbum);
    return albums.length >= MIN_SHELF_ITEMS ? { key, title: shelf.title, albums } : null;
}

export default function HomeScreen({ navigation }: any) {
    const { playTrack, currentTrack } = usePlayerSummary();
    const { colors, theme } = useTheme();
    useScreenStatusBar(theme === 'soundwave' ? 'dark-content' : 'light-content', colors.background);
    const c = theme === 'soundwave' ? GX_LIGHT : GX_DARK;
    const songMenu = useSongMenu();
    const { width } = useWindowDimensions();
    const heroWidth = heroCardWidth(width);
    const columnWidth = trackColumnWidth(width);

    const [recentTracks, setRecentTracks] = useState<Track[]>([]);
    const [recentsAsList, setRecentsAsList] = useState(true);
    // The heading greets the listener by first name, re-read when Home comes back
    // into view so a name changed in the profile shows up straight away.
    const [firstName, setFirstName] = useState('');
    useFocusEffect(useCallback(() => {
        getUserProfile().then(profile => {
            const first = profile.displayName === 'My Library' ? '' : profile.displayName.trim().split(/\s+/)[0] ?? '';
            setFirstName(first ? first.charAt(0).toLocaleUpperCase() + first.slice(1) : '');
        }).catch(() => {});
    }, []));
    const [shelves, setShelves] = useState<Shelf[]>([]);
    const [pending, setPending] = useState(0);
    const [loadingMore, setLoadingMore] = useState(false);
    const [failed, setFailed] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const generation = useRef(0);
    const continuation = useRef<string | null>(null);

    // Shelves arrive one at a time; a title already on the page is not added twice.
    const publishedCount = useRef(0);
    const shelvesRef = useRef<Shelf[]>([]);
    const showingCache = useRef(false);
    const publish = useCallback((gen: number, shelf: Shelf | null) => {
        if (!shelf || gen !== generation.current) return;
        publishedCount.current += 1;
        const base = showingCache.current ? [] : shelvesRef.current;
        showingCache.current = false;
        shelvesRef.current = base.some(item => item.title.toLocaleLowerCase() === shelf.title.toLocaleLowerCase()) ? base : [...base, shelf];
        setShelves(shelvesRef.current);
    }, []);

    // Home first, then New releases and Explore, each painted as soon as it lands.
    const loadHome = useCallback(async () => {
        const gen = ++generation.current;
        continuation.current = null;
        publishedCount.current = 0;
        // A cached Home stays on screen until fresh shelves replace it.
        if (!showingCache.current) { shelvesRef.current = []; setShelves([]); }
        setFailed(false);
        setPending(1 + HOME_SUPPLEMENT_BROWSE_IDS.length);
        getListeningProfile().then(profile => { if (gen === generation.current) setRecentTracks(profile.recentTracks.slice(0, 12)); }).catch(() => {});

        const settle = () => { if (gen === generation.current) setPending(count => Math.max(0, count - 1)); };
        const homePage = home().then(async feed => {
            continuation.current = feed.continuation;
            // Match every shelf at once, then show them in YouTube's order.
            const resolved = feed.shelves.map((shelf, index) => resolveShelf(shelf, `home-${index}`));
            for (const shelf of resolved) publish(gen, await shelf);
        });
        const supplements = HOME_SUPPLEMENT_BROWSE_IDS.map(browseId => homeSupplement(browseId).then(async list => {
            const resolved = list.map((shelf, index) => resolveShelf(shelf, `${browseId}-${index}`));
            await homePage.catch(() => {});
            for (const shelf of resolved) publish(gen, await shelf);
        }).finally(settle));
        // Signed in with Google: the account's own likes and subscriptions.
        const personal = currentYouTubeUser().then(async user => {
            if (!user) return;
            const [likes, artists] = await Promise.all([likedTracks().catch(() => []), subscribedArtists().catch(() => [])]);
            if (likes.length >= MIN_SHELF_ITEMS) publish(gen, { key: 'yt-liked', title: 'Liked on YouTube', tracks: likes.slice(0, SHELF_ITEMS) });
            const fromArtists = await mapConcurrent(artists.slice(0, 6), 3, name => API.search(name).then(found => found.slice(0, 3)).catch(() => [] as Track[]));
            const tracks = uniqueTracks(fromArtists.flat());
            if (tracks.length >= MIN_SHELF_ITEMS) publish(gen, { key: 'yt-subs', title: 'From your subscriptions', tracks });
        }).catch(() => {});
        await Promise.allSettled([homePage.finally(settle), ...supplements, personal]);
        if (gen !== generation.current) return;
        // YouTube Music gave nothing playable (blocked on this network, or no
        // matches): fill Home from the catalogue's own charts and searches.
        if (publishedCount.current === 0) {
            const fallback = await Promise.allSettled([
                API.getGlobalChart(SHELF_ITEMS, 0),
                API.search('top hits'),
                API.search('new music'),
            ]);
            if (gen !== generation.current) return;
            const titles = ['Top charts', 'Popular right now', 'New music'];
            fallback.forEach((result, index) => {
                const tracks = result.status === 'fulfilled' ? uniqueTracks(result.value).slice(0, SHELF_ITEMS) : [];
                if (tracks.length >= MIN_SHELF_ITEMS) publish(gen, { key: `fallback-${index}`, title: titles[index], tracks });
            });
            if (publishedCount.current === 0) setFailed(true);
        }
        if (publishedCount.current > 0) AsyncStorage.setItem(HOME_CACHE_KEY, JSON.stringify(shelvesRef.current)).catch(() => {});
        setRefreshing(false);
    }, [publish]);

    useEffect(() => {
        let live = true;
        AsyncStorage.getItem(HOME_CACHE_KEY).then(raw => {
            const cached: Shelf[] = raw ? JSON.parse(raw) : [];
            if (live && cached.length && publishedCount.current === 0) {
                showingCache.current = true;
                shelvesRef.current = cached;
                setShelves(cached);
            }
        }).catch(() => {}).finally(() => { if (live) void loadHome(); });
        return () => { live = false; generation.current += 1; };
    }, [loadHome]);

    // More shelves past the first page, following Home's own continuation.
    const loadMore = useCallback(async () => {
        const token = continuation.current;
        if (!token || loadingMore || pending > 0) return;
        const gen = generation.current;
        continuation.current = null;
        setLoadingMore(true);
        try {
            const feed = await moreHome(token);
            if (gen !== generation.current) return;
            continuation.current = feed.continuation;
            for (const [index, shelf] of feed.shelves.entries()) publish(gen, await resolveShelf(shelf, `more-${token.slice(-6)}-${index}`));
        } catch {
            if (gen === generation.current) continuation.current = token;
        } finally {
            if (gen === generation.current) setLoadingMore(false);
        }
    }, [loadingMore, pending, publish]);

    const isCurrent = (track: Track) => currentTrack?.id === track.id;
    const heroShelf = shelves.find(shelf => shelf.tracks);
    const rest = useMemo(() => shelves.filter(shelf => shelf !== heroShelf), [shelves, heroShelf]);

    const recentColumns = useMemo(() => {
        const columns: Track[][] = [];
        for (let i = 0; i < recentTracks.length; i += 4) columns.push(recentTracks.slice(i, i + 4));
        return columns;
    }, [recentTracks]);

    const renderSectionHeader = (title: string, trailing?: React.ReactNode) => (
        <View style={styles.sectionHeader}>
            <View style={styles.flex}>
                <Text style={[GX_TYPE.headlineMedium, styles.sectionTitle, { color: c.onBackground }]} numberOfLines={2}>{title}</Text>
            </View>
            {trailing}
        </View>
    );

    const renderShelfCard = (track: Track, keyPrefix: string) => (
        <TouchableScale key={`${keyPrefix}-${track.id}`} style={styles.shelfCard} activeScale={0.96} onPress={() => playTrack(track)} onLongPress={() => songMenu({ kind: 'track', track }, navigation)} accessibilityRole="button" accessibilityLabel={`Play ${track.title}`}>
            <View style={[styles.shelfArt, { backgroundColor: c.surfaceVariant, borderColor: c.thumbnailBorder }]}>
                <Image source={{ uri: cover(track, 320) }} style={StyleSheet.absoluteFill} />
            </View>
            <Text style={[GX_TYPE.titleMedium, styles.shelfTitle, { color: isCurrent(track) ? PLAYING_ACCENT : c.onBackground }]} numberOfLines={1}>{track.title}</Text>
            <Text style={[GX_TYPE.bodyMedium, { color: c.onSurfaceVariant }]} numberOfLines={1}>{track.artist?.name}</Text>
        </TouchableScale>
    );

    const renderAlbumCard = (album: Album, keyPrefix: string) => (
        <TouchableScale key={`${keyPrefix}-${album.id}`} style={styles.shelfCard} activeScale={0.96} onPress={() => (album as { ytBrowseId?: string }).ytBrowseId
            ? navigation.navigate('AlbumDetail', { ytPlaylistId: (album as { ytBrowseId?: string }).ytBrowseId, ytPlaylistData: { browseId: (album as { ytBrowseId?: string }).ytBrowseId, title: album.title, subtitle: album.artist?.name ?? '', thumbnail: album.cover } })
            : navigation.navigate('AlbumDetail', { albumId: album.id, albumData: album })} onLongPress={() => songMenu({ kind: 'album', album }, navigation)} accessibilityRole="button" accessibilityLabel={album.title}>
            <View style={[styles.shelfArt, { backgroundColor: c.surfaceVariant, borderColor: c.thumbnailBorder }]}>
                <Image source={{ uri: API.getCoverUrl(album.cover, 320) }} style={StyleSheet.absoluteFill} />
            </View>
            <Text style={[GX_TYPE.titleMedium, styles.shelfTitle, { color: c.onBackground }]} numberOfLines={1}>{album.title}</Text>
            <Text style={[GX_TYPE.bodyMedium, { color: c.onSurfaceVariant }]} numberOfLines={1}>{album.artist?.name}</Text>
        </TouchableScale>
    );

    const renderHeroCard = (track: Track, keyPrefix: string) => (
        <TouchableScale key={`${keyPrefix}-${track.id}`} style={[styles.heroCard, { width: heroWidth, backgroundColor: c.surfaceVariant, borderColor: c.thumbnailBorder }]} activeScale={0.97} onPress={() => playTrack(track)} onLongPress={() => songMenu({ kind: 'track', track }, navigation)} accessibilityRole="button" accessibilityLabel={`Play ${track.title}`}>
            <Image source={{ uri: cover(track, 640) }} style={StyleSheet.absoluteFill} />
            <LinearGradient colors={['transparent', 'rgba(0,0,0,0.78)']} style={styles.heroCaption}>
                <Text style={[GX_TYPE.titleLarge, { color: isCurrent(track) ? PLAYING_ACCENT : '#FFFFFF' }]} numberOfLines={1}>{track.title}</Text>
                <Text style={[GX_TYPE.bodyMedium, { color: 'rgba(255,255,255,0.72)' }]} numberOfLines={2}>{track.artist?.name}</Text>
            </LinearGradient>
        </TouchableScale>
    );

    const shownShelves = useRef(new Set<string>());
    const renderShelf = ({ item }: { item: Shelf }) => {
        const fresh = !shownShelves.current.has(item.key) && !appSettings().reduceAnimation;
        shownShelves.current.add(item.key);
        return (
            <Animated.View entering={fresh ? FadeIn.duration(280) : undefined} style={styles.shelf}>
                {renderSectionHeader(item.title)}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelfRow}>
                    {item.tracks ? item.tracks.map(track => renderShelfCard(track, item.key)) : (item.albums ?? []).map(album => renderAlbumCard(album, item.key))}
                </ScrollView>
            </Animated.View>
        );
    };

    const skeletonBlock = { backgroundColor: c.surfaceVariant };
    const shelfSkeleton = (
        <View style={styles.shelf}>
            <View style={[styles.skeletonHeader, skeletonBlock]} />
            <View style={styles.shelfRow}>
                {[0, 1, 2].map(i => <View key={i} style={[styles.shelfArt, { width: SHELF_CARD_WIDTH, borderWidth: 0 }, skeletonBlock]} />)}
            </View>
        </View>
    );

    return (
        <SafeAreaView style={[styles.root, { backgroundColor: c.background }]} edges={['top']}>
            <FlatList
                data={rest}
                keyExtractor={item => item.key}
                renderItem={renderShelf}
                showsVerticalScrollIndicator={false}
                removeClippedSubviews
                onEndReached={loadMore}
                onEndReachedThreshold={0.8}
                initialNumToRender={3}
                maxToRenderPerBatch={3}
                windowSize={5}
                contentContainerStyle={styles.scrollContent}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadHome(); }} tintColor={c.onBackground} />}
                ListHeaderComponent={<>
                    <View style={styles.topBar}>
                        <ProfileCircle />
                    </View>
                    <View style={styles.homeTitle}>
                        <Ionicons name="musical-notes" size={31} color={c.onBackground} style={styles.mark} />
                        <Text style={[GX_TYPE.displayLarge, { color: c.onBackground }]}>{firstName ? `Hi ${firstName}` : 'Hi there'}</Text>
                    </View>

                    {recentColumns.length > 0 && (
                        <View style={styles.shelf}>
                            {renderSectionHeader('Recents', (
                                <TouchableScale style={styles.viewToggle} activeScale={0.9} onPress={() => setRecentsAsList(v => !v)} accessibilityRole="button" accessibilityLabel={recentsAsList ? 'Switch to grid view' : 'Switch to list view'}>
                                    <Ionicons name={recentsAsList ? 'grid-outline' : 'list-outline'} size={19} color={c.onSurfaceVariant} />
                                </TouchableScale>
                            ))}
                            {recentsAsList ? (
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.shelfRow, styles.recentRow]}>
                                    {recentColumns.map((column, columnIndex) => (
                                        <View key={`recent-col-${columnIndex}`} style={{ width: columnWidth }}>
                                            {column.map(track => (
                                                <TouchableScale key={`recent-${track.id}`} style={styles.compactRow} activeScale={0.985} onPress={() => playTrack(track)} onLongPress={() => songMenu({ kind: 'track', track }, navigation)} accessibilityRole="button" accessibilityLabel={`Play ${track.title}`}>
                                                    <Image source={{ uri: cover(track, 140) }} style={[styles.compactArt, { backgroundColor: c.surfaceVariant, borderColor: c.thumbnailBorder }]} />
                                                    <View style={styles.flex}>
                                                        <Text style={[GX_TYPE.titleMedium, { color: isCurrent(track) ? PLAYING_ACCENT : c.onBackground }]} numberOfLines={1}>{track.title}</Text>
                                                        <Text style={[GX_TYPE.bodyMedium, { color: c.onSurfaceVariant }]} numberOfLines={1}>{track.artist?.name}</Text>
                                                    </View>
                                                </TouchableScale>
                                            ))}
                                        </View>
                                    ))}
                                </ScrollView>
                            ) : (
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelfRow}>
                                    {recentTracks.map(track => renderHeroCard(track, 'recent-hero'))}
                                </ScrollView>
                            )}
                        </View>
                    )}

                    {heroShelf?.tracks ? (
                        <Animated.View entering={appSettings().reduceAnimation ? undefined : FadeIn.duration(280)} style={styles.shelf}>
                            {renderSectionHeader(heroShelf.title)}
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelfRow}>
                                {heroShelf.tracks.slice(0, 10).map(track => renderHeroCard(track, 'hero'))}
                            </ScrollView>
                        </Animated.View>
                    ) : failed ? (
                        <View style={styles.messageState}>
                            <Text style={[GX_TYPE.titleMedium, { color: c.onBackground }]}>Couldn't load your music</Text>
                            <TouchableScale onPress={loadHome} accessibilityRole="button" accessibilityLabel="Retry loading music">
                                <Text style={[GX_TYPE.titleMedium, styles.retry, { color: ACCENT_RED }]}>Retry</Text>
                            </TouchableScale>
                        </View>
                    ) : (
                        <SkeletonPulse>
                            <View style={styles.shelf} accessibilityRole="progressbar" accessibilityLabel="Loading music">
                                <View style={[styles.skeletonHeader, skeletonBlock]} />
                                <View style={styles.shelfRow}>
                                    <View style={[styles.heroCard, { width: heroWidth, borderWidth: 0 }, skeletonBlock]} />
                                    <View style={[styles.heroCard, { width: heroWidth, borderWidth: 0 }, skeletonBlock]} />
                                </View>
                            </View>
                        </SkeletonPulse>
                    )}
                </>}
                ListFooterComponent={(
                    <>
                        {(pending > 0 || loadingMore) && heroShelf && <SkeletonPulse>{shelfSkeleton}</SkeletonPulse>}
                        <View style={styles.playerClearance} />
                    </>
                )}
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    flex: { flex: 1, minWidth: 0 },
    scrollContent: { paddingBottom: 24 },
    topBar: { alignItems: 'flex-end', paddingHorizontal: PAGE_GUTTER, paddingTop: 4, marginBottom: -26 },
    homeTitle: { paddingHorizontal: PAGE_GUTTER, paddingTop: 8, paddingBottom: 8 },
    mark: { marginBottom: 14 },
    shelf: { paddingBottom: 26 },
    sectionTitle: {},
    sectionHeader: { paddingHorizontal: PAGE_GUTTER, paddingVertical: 10, flexDirection: 'row', alignItems: 'center' },
    viewToggle: { width: 32, height: 32, borderRadius: 16, marginLeft: 8, alignItems: 'center', justifyContent: 'center' },
    shelfRow: { paddingHorizontal: PAGE_GUTTER, gap: 14, flexDirection: 'row' },
    recentRow: { gap: 12 },
    shelfCard: { width: SHELF_CARD_WIDTH },
    shelfArt: { width: '100%', aspectRatio: 1, borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
    shelfTitle: { marginTop: 10 },
    heroCard: { aspectRatio: HERO_CARD_RATIO, borderRadius: 18, borderWidth: 1, overflow: 'hidden', justifyContent: 'flex-end' },
    heroCaption: { paddingHorizontal: 16, paddingTop: 34, paddingBottom: 14 },
    compactRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, gap: 12 },
    compactArt: { width: 48, height: 48, borderRadius: 7, borderWidth: 1 },
    messageState: { padding: 32, alignItems: 'center' },
    retry: { marginTop: 10 },
    skeletonHeader: { width: 180, height: 22, borderRadius: 6, marginHorizontal: PAGE_GUTTER, marginVertical: 14 },
    playerClearance: { height: 145 },
});
