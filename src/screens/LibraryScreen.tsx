// LibraryScreen: heading, link list, then grid shelves
// that stop at five cards with a "Show all" page behind them.
import React, { useCallback, useState } from 'react';
import { Image, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { API } from '../api';
import type { Track } from '../types';
import { usePlayerSummary } from '../context/PlayerContext';
import { useTheme } from '../context/ThemeContext';
import { getListeningProfile } from '../store/listeningProfile';
import { currentYouTubeUser, myPlaylists, type YouTubePlaylist } from '../services/youtubeAccount';
import { getImportedPlaylists, type ImportedPlaylist } from '../store/importedPlaylists';
import { useScreenStatusBar } from '../hooks/useScreenStatusBar';
import { BackBar } from '../components/GlassHeader';
import GlassHeader from '../components/GlassHeader';
import { ReplayCardRow } from './ReplayScreen';
import { GX_DARK, GX_LIGHT, GX_TYPE, PAGE_GUTTER, PLAYING_ACCENT, SHELF_CARD_WIDTH, type GXColors } from '../theme/groovix';

const LIBRARY_ROW_MAX_ITEMS = 5;
const LIBRARY_GRID_SPACING = 12;
const LINK_ICON_SIZE = 24;
const LINK_ICON_GAP = 16;

type ShelfCardItem = { key: string; title: string; subtitle: string; cover?: string; onPress: () => void; current?: boolean };

function SectionHeader({ title, onShowAll, c }: { title: string; onShowAll?: () => void; c: GXColors }) {
    return (
        <View style={styles.sectionHeader}>
            <Text style={[GX_TYPE.headlineMedium, styles.flex, { color: c.onBackground }]} numberOfLines={2}>{title}</Text>
            {onShowAll && (
                <TouchableOpacity onPress={onShowAll} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Show all ${title}`}>
                    <Text style={[GX_TYPE.titleSmall, styles.showAll, { color: c.primary }]}>Show all</Text>
                </TouchableOpacity>
            )}
        </View>
    );
}

function ShelfCard({ item, c, width = SHELF_CARD_WIDTH }: { item: ShelfCardItem; c: GXColors; width?: number }) {
    return (
        <TouchableOpacity style={{ width }} onPress={item.onPress} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={item.title}>
            <View style={[styles.cardArt, { width, height: width, backgroundColor: c.surfaceVariant, borderColor: c.thumbnailBorder }]}>
                {item.cover ? <Image source={{ uri: item.cover }} style={StyleSheet.absoluteFill} /> : <Ionicons name="musical-notes" size={40} color={c.onSurfaceVariant} />}
            </View>
            <Text style={[GX_TYPE.titleMedium, styles.cardTitle, { color: item.current ? PLAYING_ACCENT : c.onBackground }]} numberOfLines={1}>{item.title}</Text>
            <Text style={[GX_TYPE.bodyMedium, { color: c.onSurfaceVariant }]} numberOfLines={1}>{item.subtitle}</Text>
        </TouchableOpacity>
    );
}

// dashed "New playlist" tile sitting in line with the covers.
function NewShelfCard({ icon, label, subtitle, onPress, c, width = SHELF_CARD_WIDTH }: { icon: string; label: string; subtitle: string; onPress: () => void; c: GXColors; width?: number }) {
    return (
        <TouchableOpacity style={{ width }} onPress={onPress} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={label}>
            <View style={[styles.cardArt, { width, height: width, borderWidth: 0, backgroundColor: c.surfaceVariant }]}>
                <Ionicons name={icon} size={46} color={c.onBackground} />
            </View>
        </TouchableOpacity>
    );
}

function playlistCover(playlist: ImportedPlaylist): string | undefined {
    if (playlist.cover) return playlist.cover;
    const first = playlist.tracks.find(track => track.resolved?.album?.cover)?.resolved;
    return first ? API.getCoverUrl(first.album?.cover, 320) : undefined;
}

export default function LibraryScreen({ navigation }: any) {
    const { colors, theme } = useTheme();
    useScreenStatusBar(theme === 'soundwave' ? 'dark-content' : 'light-content', colors.background);
    const c = theme === 'soundwave' ? GX_LIGHT : GX_DARK;
    const { playTrack, currentTrack } = usePlayerSummary();
    const [playlists, setPlaylists] = useState<ImportedPlaylist[]>([]);
    const [liked, setLiked] = useState<Track[]>([]);
    const [recent, setRecent] = useState<Track[]>([]);
    const [refreshing, setRefreshing] = useState(false);
    const [ytPlaylists, setYtPlaylists] = useState<YouTubePlaylist[] | null>(null);

    const load = useCallback(async () => {
        const [imported, profile] = await Promise.all([getImportedPlaylists(), getListeningProfile()]);
        setPlaylists(imported);
        setLiked(profile.likedTracks);
        setRecent(profile.recentTracks);
        // Signed in with Google: the account's YouTube playlists.
        const user = await currentYouTubeUser().catch(() => null);
        setYtPlaylists(user ? await myPlaylists().catch(() => []) : null);
    }, []);

    useFocusEffect(useCallback(() => { void load(); }, [load]));

    const trackItem = (track: Track, prefix: string): ShelfCardItem => ({
        key: `${prefix}-${track.id}`,
        title: track.title,
        subtitle: track.artist?.name || '',
        cover: API.getCoverUrl(track.album?.cover, 320),
        onPress: () => playTrack(track),
        current: currentTrack?.id === track.id,
    });

    const playlistItem = (playlist: ImportedPlaylist): ShelfCardItem => ({
        key: `pl-${playlist.id}`,
        title: playlist.title,
        subtitle: `Playlist · ${playlist.tracks.length} songs`,
        cover: playlistCover(playlist),
        onPress: () => navigation.navigate('Profile', { openPlaylistId: playlist.id }),
    });

    // Downloads, then liked songs here in
    // place of local files; Replay leads as cards, Settings sits behind the
    // profile circle and history behind the clock.
    const links: { icon: string; title: string; onPress: () => void }[] = [
        { icon: 'download', title: 'Downloads', onPress: () => navigation.navigate('AlbumDetail', { collection: 'downloads' }) },
        { icon: 'heart', title: 'Liked songs', onPress: () => navigation.navigate('AlbumDetail', { collection: 'liked' }) },
    ];

    const gridShelf = (title: string, items: ShelfCardItem[], kind: string, leading?: React.ReactNode, leadingCount = 0) => (
        <View style={styles.shelf}>
            <SectionHeader
                title={title}
                c={c}
                onShowAll={items.length + leadingCount > LIBRARY_ROW_MAX_ITEMS ? () => navigation.navigate('LibraryGrid', { kind }) : undefined}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelfRow}>
                {leading}
                {items.slice(0, Math.max(0, LIBRARY_ROW_MAX_ITEMS - leadingCount)).map(item => <ShelfCard key={item.key} item={item} c={c} />)}
            </ScrollView>
        </View>
    );

    return (
        <SafeAreaView style={[styles.root, { backgroundColor: c.background }]} edges={['top']}>
            <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.content}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={c.onBackground} />}
            >
                <GlassHeader onHistory={() => navigation.navigate('LibraryGrid', { kind: 'recent' })} />
                <Text style={[GX_TYPE.displayLarge, styles.title, { color: c.onBackground }]}>Library</Text>
                <ReplayCardRow onOpen={() => navigation.navigate('Replay')} />

                <View style={styles.links}>
                    {links.map((link, index) => (
                        <View key={link.title}>
                            <TouchableOpacity style={styles.linkRow} onPress={link.onPress} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={link.title}>
                                <Ionicons name={link.icon} size={LINK_ICON_SIZE} color={c.onBackground} />
                                <Text style={[GX_TYPE.bodyLarge, styles.linkText, { color: c.onBackground }]} numberOfLines={1}>{link.title}</Text>
                                <Ionicons name="chevron-forward" size={20} color={c.onSurfaceVariant} style={styles.chevron} />
                            </TouchableOpacity>
                            {index < links.length - 1 && <View style={[styles.linkDivider, { backgroundColor: c.outline }]} />}
                        </View>
                    ))}
                </View>

                {gridShelf('Playlists', playlists.map(playlistItem), 'playlists', (
                    <>
                        <NewShelfCard icon="add" label="New playlist" subtitle="" onPress={() => navigation.navigate('Profile', { openImport: true })} c={c} />
                        <NewShelfCard icon="link" label="Import a playlist link" subtitle="" onPress={() => navigation.navigate('Profile', { openImport: true })} c={c} />
                    </>
                ), 2)}
                {ytPlaylists && gridShelf('From YouTube', ytPlaylists.map(playlist => ({
                    key: `yt-${playlist.id}`, title: playlist.title, subtitle: `Playlist · ${playlist.count} videos`, cover: playlist.thumbnail,
                    onPress: () => navigation.navigate('AlbumDetail', { collection: 'youtube', youtubePlaylistId: playlist.id, youtubePlaylistTitle: playlist.title, youtubePlaylistCover: playlist.thumbnail }),
                })), 'youtube', (
                    <NewShelfCard icon="heart" label="Liked on YouTube" subtitle="" onPress={() => navigation.navigate('AlbumDetail', { collection: 'youtubeLiked' })} c={c} />
                ), 1)}
                {liked.length > 0 && gridShelf('Liked songs', liked.map(track => trackItem(track, 'liked')), 'liked')}
                {recent.length > 0 && gridShelf('Recently played', recent.map(track => trackItem(track, 'recent')), 'recent')}
            </ScrollView>
        </SafeAreaView>
    );
}

// LibraryGridPage: the whole shelf as a grid.
export function LibraryGridPage({ navigation, route }: any) {
    const kind: 'liked' | 'recent' | 'playlists' | 'youtube' = route?.params?.kind ?? 'liked';
    const { theme } = useTheme();
    const c = theme === 'soundwave' ? GX_LIGHT : GX_DARK;
    const { playTrack, currentTrack } = usePlayerSummary();
    const { width } = useWindowDimensions();
    const columns = Math.max(2, Math.floor((width - PAGE_GUTTER * 2 + LIBRARY_GRID_SPACING) / (SHELF_CARD_WIDTH + LIBRARY_GRID_SPACING)));
    const cardWidth = (width - PAGE_GUTTER * 2 - LIBRARY_GRID_SPACING * (columns - 1)) / columns;
    const [items, setItems] = useState<ShelfCardItem[]>([]);

    useFocusEffect(useCallback(() => {
        let live = true;
        (async () => {
            if (kind === 'youtube') {
                const all = await myPlaylists().catch(() => []);
                if (live) setItems(all.map(playlist => ({
                    key: `yt-${playlist.id}`, title: playlist.title, subtitle: `Playlist · ${playlist.count} videos`, cover: playlist.thumbnail,
                    onPress: () => navigation.navigate('AlbumDetail', { collection: 'youtube', youtubePlaylistId: playlist.id, youtubePlaylistTitle: playlist.title, youtubePlaylistCover: playlist.thumbnail }),
                })));
                return;
            }
            if (kind === 'playlists') {
                const all = await getImportedPlaylists();
                if (live) setItems(all.map(playlist => ({
                    key: `pl-${playlist.id}`, title: playlist.title, subtitle: `Playlist · ${playlist.tracks.length} songs`,
                    cover: playlistCover(playlist), onPress: () => navigation.navigate('Profile', { openPlaylistId: playlist.id }),
                })));
                return;
            }
            const profile = await getListeningProfile();
            const tracks = kind === 'liked' ? profile.likedTracks : profile.recentTracks;
            if (live) setItems(tracks.map(track => ({
                key: `${kind}-${track.id}`, title: track.title, subtitle: track.artist?.name || '',
                cover: API.getCoverUrl(track.album?.cover, 320), onPress: () => playTrack(track), current: currentTrack?.id === track.id,
            })));
        })();
        return () => { live = false; };
    }, [kind, navigation, playTrack, currentTrack]));

    const title = kind === 'liked' ? 'Liked songs' : kind === 'recent' ? 'Recently played' : kind === 'youtube' ? 'From YouTube' : 'Playlists';

    return (
        <SafeAreaView style={[styles.root, { backgroundColor: c.background }]} edges={['top']}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
                <BackBar />
                <Text style={[GX_TYPE.displayLarge, styles.title, { color: c.onBackground }]} numberOfLines={1}>{title}</Text>
                {items.length === 0 ? (
                    <Text style={[GX_TYPE.bodyMedium, styles.empty, { color: c.onSurfaceVariant }]}>Nothing here yet</Text>
                ) : (
                    <View style={styles.grid}>
                        {items.map(item => <ShelfCard key={item.key} item={item} c={c} width={cardWidth} />)}
                    </View>
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    flex: { flex: 1 },
    content: { paddingBottom: 160 },
    title: { paddingHorizontal: PAGE_GUTTER, paddingTop: 8, paddingBottom: 8 },
    links: { paddingTop: 4, paddingBottom: 22 },
    linkRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', paddingHorizontal: PAGE_GUTTER },
    linkText: { flex: 1, marginLeft: LINK_ICON_GAP },
    chevron: { opacity: 0.6 },
    linkDivider: { height: 0.5, marginLeft: PAGE_GUTTER + LINK_ICON_SIZE + LINK_ICON_GAP },
    shelf: { paddingBottom: 26 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: PAGE_GUTTER, paddingVertical: 10 },
    showAll: { paddingLeft: 12, paddingVertical: 4 },
    shelfRow: { paddingHorizontal: PAGE_GUTTER, gap: LIBRARY_GRID_SPACING, flexDirection: 'row' },
    cardArt: { borderRadius: 12, borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
    cardTitle: { marginTop: 10 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: PAGE_GUTTER, columnGap: LIBRARY_GRID_SPACING, rowGap: 20 },
    empty: { textAlign: 'center', paddingTop: 48 },
});
