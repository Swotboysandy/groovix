// DetailScreen: one page for albums, playlists and artists.
// Releases get the centred sleeve over a blurred wash; artists get the
// full-bleed photo, the play circle and paged top songs.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import Ionicons from 'react-native-vector-icons/Ionicons';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { listDownloadedTracks, type DownloadedTrackFile } from '../services/downloads';
import { getListeningProfile } from '../store/listeningProfile';
import { likedTracks, playlistTracks } from '../services/youtubeAccount';
import { API } from '../api';
import type { Album, Artist, Playlist, Track } from '../types';
import { usePlayer } from '../context/PlayerContext';
import { useTheme } from '../context/ThemeContext';
import SkeletonPulse from '../components/SkeletonPulse';
import { useScreenStatusBar } from '../hooks/useScreenStatusBar';
import { useSongMenu } from '../components/SongMenu';
import { BackCircle, glassStyles } from '../components/GlassHeader';
import { playlistSongs, youtubeTrack, type YtPlaylist } from '../services/ytmusic';
import { GX_DARK, GX_LIGHT, GX_TYPE, PAGE_GUTTER, PLAYING_ACCENT, SHELF_CARD_WIDTH, trackColumnWidth, type GXColors } from '../theme/groovix';

const SLEEVE_FRACTION = 0.76;
const SLEEVE_MAX_HEIGHT = 0.5;
const RELEASE_SIDE_BUTTON = 50;
const RELEASE_ACTION_GAP = 14;
const HEADER_GUTTER = PAGE_GUTTER + 8;
const HEADER_DROP = 44;
const ARTIST_HEADER_LIFT = 64;
const ARTIST_PHOTO_RATIO = 0.95;
const ARTIST_PLAY_BUTTON = 70;
const ARTIST_SIDE_BUTTON = 52;
const ARTIST_ACTION_GAP = 24;
const SONGS_PER_COLUMN = 4;
const LIGHT_FILL_ALPHA = 0.07;
const EDGE_ALPHA = 0.10;

type Params = {
    albumId?: number; albumData?: Album;
    playlistId?: string; playlistData?: Playlist;
    artistId?: number; artistData?: Artist;
    ytPlaylistId?: string; ytPlaylistData?: YtPlaylist;
    collection?: 'downloads' | 'liked' | 'youtube' | 'youtubeLiked';
    youtubePlaylistId?: string; youtubePlaylistTitle?: string; youtubePlaylistCover?: string;
};

// Groovix shows Downloads and Liked songs as a release page with a glyph sleeve.
const COLLECTIONS = {
    downloads: { title: 'Downloads', subtitle: 'Downloaded songs', icon: 'download' },
    liked: { title: 'Liked songs', subtitle: 'Songs you starred', icon: 'star' },
    youtube: { title: 'Playlist', subtitle: 'From your YouTube', icon: 'youtube' },
    youtubeLiked: { title: 'Liked on YouTube', subtitle: 'Videos you liked, as songs', icon: 'thumb-up' },
} as const;

function downloadedTrack(file: DownloadedTrackFile): Track {
    return {
        id: Math.abs(file.path.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0)),
        title: file.title,
        duration: 0,
        artist: { id: 0, name: file.artist },
        album: { id: 0, title: 'Downloads', cover: file.coverPath ? `file://${file.coverPath}` : '' },
        audioQuality: file.quality || 'LOSSLESS',
        source: 'audiomack',
        localPath: file.path,
    } as any;
}

function releaseKind(item: Album, singles: Album[]): string {
    if (!singles.some(single => single.id === item.id)) return 'Album';
    return (item.numberOfTracks ?? 1) > 3 ? 'EP' : 'Single';
}

function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}

function playtime(tracks: Track[]): string | null {
    const total = tracks.reduce((sum, track) => sum + (track.duration || 0), 0);
    if (!total) return null;
    const h = Math.floor(total / 3600);
    const m = Math.round((total % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${Math.max(1, m)} min`;
}

function CircleIconButton({ icon, label, onPress, size, enabled = true, c }: { icon: string; label: string; onPress: () => void; size: number; enabled?: boolean; c: GXColors }) {
    return (
        <TouchableOpacity
            disabled={!enabled}
            onPress={onPress}
            activeOpacity={0.75}
            style={[styles.circleButton, { width: size, height: size, borderRadius: size / 2, opacity: enabled ? 1 : 0.38 }]}
            accessibilityRole="button"
            accessibilityLabel={label}
        >
            <Ionicons name={icon} size={size * 0.44} color={c.onSurface} />
        </TouchableOpacity>
    );
}

function SectionHeading({ title, c, onShowAll }: { title: string; c: GXColors; onShowAll?: () => void }) {
    return (
        <View style={styles.sectionHeading}>
            <Text style={[GX_TYPE.headlineMedium, styles.flex, { color: c.onBackground }]} numberOfLines={1}>{title}</Text>
            {onShowAll && (
                <TouchableOpacity onPress={onShowAll} hitSlop={6} accessibilityRole="button">
                    <Ionicons name="chevron-forward" size={22} color={c.onSurfaceVariant} />
                </TouchableOpacity>
            )}
        </View>
    );
}

export default function AlbumDetailScreen({ route, navigation }: any) {
    const params: Params = route.params || {};
    const { playPlaylist, currentTrack } = usePlayer();
    const { colors, theme } = useTheme();
    useScreenStatusBar('light-content', colors.background);
    const c = theme === 'soundwave' ? GX_LIGHT : GX_DARK;
    const insets = useSafeAreaInsets();
    const { width, height } = useWindowDimensions();
    const isArtist = params.artistId != null;
    const collection = params.collection ? COLLECTIONS[params.collection] : null;
    const isPlaylist = params.playlistId != null || params.ytPlaylistId != null || collection != null;
    const songMenu = useSongMenu();
    const [reversed, setReversed] = useState(false);

    const [album, setAlbum] = useState<(Album & { copyright?: string }) | null>(params.albumData ?? null);
    const [playlist, setPlaylist] = useState<Playlist | null>(params.playlistData ?? (params.ytPlaylistData ? {
        id: params.ytPlaylistData.browseId, title: params.ytPlaylistData.title, cover: params.ytPlaylistData.thumbnail ?? '',
        numberOfTracks: 0, duration: 0, creatorName: 'YouTube Music',
    } : null));
    const [artist, setArtist] = useState<Artist | null>(params.artistData ?? null);
    const [tracks, setTracks] = useState<Track[]>([]);
    const [albums, setAlbums] = useState<Album[]>([]);
    const [singles, setSingles] = useState<Album[]>([]);
    const [moreByArtist, setMoreByArtist] = useState<Album[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let live = true;
        (async () => {
            setLoading(true);
            if (params.artistId != null) {
                const page = await API.getArtist(params.artistId);
                if (!live) return;
                if (page.artist) setArtist(page.artist);
                setTracks(page.topTracks);
                setAlbums(page.albums);
                setSingles(page.singles);
            } else if (params.collection === 'downloads') {
                const files = await listDownloadedTracks().catch(() => []);
                if (!live) return;
                setTracks(files.map(downloadedTrack));
            } else if (params.collection === 'youtube' && params.youtubePlaylistId) {
                const found = await playlistTracks(params.youtubePlaylistId).catch(() => []);
                if (!live) return;
                setTracks(found);
            } else if (params.collection === 'youtubeLiked') {
                const found = await likedTracks().catch(() => []);
                if (!live) return;
                setTracks(found);
            } else if (params.collection === 'liked') {
                const profile = await getListeningProfile();
                if (!live) return;
                setTracks(profile.likedTracks);
            } else if (params.ytPlaylistId != null) {
                // A YouTube Music playlist or album: its songs list straight
                // away, and each is matched to a playable recording when it plays.
                const page = await playlistSongs(params.ytPlaylistId);
                if (!live) return;
                setPlaylist(current => ({
                    id: params.ytPlaylistId!, title: page.title || current?.title || '', cover: page.thumbnail || current?.cover || '',
                    numberOfTracks: page.songs.length, duration: 0, creatorName: 'YouTube Music',
                }));
                setTracks(page.songs.map(youtubeTrack));
            } else if (params.playlistId != null) {
                const page = await API.getPlaylist(params.playlistId);
                if (!live) return;
                if (page.playlist) setPlaylist(page.playlist);
                setTracks(page.tracks);
            } else if (params.albumId != null) {
                const page = await API.getAlbum(params.albumId);
                if (!live) return;
                if (page.album) setAlbum(page.album);
                setTracks(page.tracks);
                const artistId = (page.album ?? params.albumData)?.artist?.id;
                if (artistId) {
                    API.getArtist(artistId).then(more => {
                        if (live) setMoreByArtist([...more.albums, ...more.singles].filter(item => item.id !== params.albumId).slice(0, 12));
                    }).catch(() => {});
                }
            }
            if (live) setLoading(false);
        })();
        return () => { live = false; };
    }, [params.albumId, params.playlistId, params.artistId, params.albumData, params.ytPlaylistId, params.collection]);

    const play = useCallback((index = 0) => { if (tracks.length) playPlaylist(tracks, index); }, [tracks, playPlaylist]);
    const shuffle = useCallback(() => {
        if (!tracks.length) return;
        const shuffled = tracks.slice();
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        playPlaylist(shuffled, 0);
    }, [tracks, playPlaylist]);

    const openArtist = (id?: number, data?: Artist) => { if (id) navigation.push('AlbumDetail', { artistId: id, artistData: data }); };
    const openAlbum = (item: Album) => navigation.push('AlbumDetail', { albumId: item.id, albumData: item });

    const coverId = params.youtubePlaylistCover ?? (isArtist ? artist?.picture : isPlaylist ? playlist?.cover : album?.cover);
    const art = coverId ? API.getCoverUrl(coverId, 640) : undefined;
    const latest = isArtist ? [...singles, ...albums].sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''))[0] : undefined;
    const tintArt = isArtist ? (API.getCoverUrl(latest?.cover || tracks[0]?.album?.cover, 320) || art) : art;
    const title = (params.youtubePlaylistTitle || (collection ? collection.title : isArtist ? artist?.name : isPlaylist ? playlist?.title : album?.title)) || '';
    const credit = collection ? collection.subtitle : isArtist ? '' : isPlaylist ? (playlist?.creatorName || '') : (album?.artist?.name || album?.artists?.map(a => a.name).join(', ') || '');
    const meta = useMemo(() => {
        if (isArtist) return '';
        if (collection) return tracks.length ? `${tracks.length} ${tracks.length === 1 ? 'Track' : 'Tracks'}` : '';
        const count = tracks.length || (isPlaylist ? playlist?.numberOfTracks : album?.numberOfTracks) || 0;
        const kind = isPlaylist ? 'Playlist' : count > 0 && count <= 3 ? 'Single' : count <= 6 ? 'EP' : 'Album';
        const parts = [kind];
        const year = album?.releaseDate?.slice(0, 4);
        if (!isPlaylist && year) parts.push(year);
        if (count) parts.push(`${count} ${count === 1 ? 'Track' : 'Tracks'}`);
        const time = playtime(tracks);
        if (time) parts.push(time);
        return parts.join(' · ');
    }, [isArtist, isPlaylist, album, playlist, tracks]);

    const artHeight = isArtist ? width * ARTIST_PHOTO_RATIO : width;
    const sleeve = Math.min(width * SLEEVE_FRACTION, height * SLEEVE_MAX_HEIGHT);

    // PageBackground: the art, washed into the page colour at its foot.
    const background = (
        <View style={[styles.pageBackground, { height: artHeight }]} pointerEvents="none">
            {art ? <Image source={{ uri: art }} style={StyleSheet.absoluteFill} blurRadius={isArtist ? 0 : 24} /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: c.surfaceVariant }]} />}
            {!isArtist && <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.25)' }]} />}
            <LinearGradient
                colors={['transparent', 'transparent', `${c.background}4D`, `${c.background}B8`, `${c.background}F2`, c.background]}
                locations={[0, 0.45, 0.65, 0.82, 0.94, 1]}
                style={StyleSheet.absoluteFill}
            />
        </View>
    );

    const isCurrent = (track: Track) => currentTrack?.id === track.id;

    const songRow = (track: Track, index: number, numbered: boolean, list: Track[]) => (
        <View key={`${track.id}-${index}`}>
            <TouchableOpacity style={styles.songRow} onPress={() => playPlaylist(list, index)} onLongPress={() => songMenu({ kind: 'track', track }, navigation)} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={`Play ${track.title}`}>
                {numbered ? (
                    <Text style={[GX_TYPE.bodyLarge, styles.trackNumber, { color: c.onSurfaceVariant }]}>{track.trackNumber || index + 1}</Text>
                ) : (
                    <Image source={{ uri: API.getCoverUrl(track.album?.cover || coverId, 160) }} style={[styles.rowArt, { backgroundColor: c.surfaceVariant, borderColor: c.thumbnailBorder }]} />
                )}
                <View style={styles.rowCopy}>
                    <Text style={[GX_TYPE.titleMedium, { color: isCurrent(track) ? PLAYING_ACCENT : c.onBackground, lineHeight: 24 }]} numberOfLines={1}>
                        {track.title}{track.explicit ? '  🅴' : ''}
                    </Text>
                    <Text style={[GX_TYPE.bodyMedium, { color: 'rgba(255,255,255,0.72)', lineHeight: 20 }]} numberOfLines={1}>
                        {track.artists?.map(a => a.name).join(', ') || track.artist?.name}
                    </Text>
                </View>
                {track.duration > 0 && <Text style={[GX_TYPE.bodyMedium, styles.duration]}>{formatDuration(track.duration)}</Text>}
                <TouchableOpacity onPress={() => songMenu({ kind: 'track', track }, navigation)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`More for ${track.title}`}>
                    <Ionicons name="ellipsis-vertical" size={20} color="rgba(255,255,255,0.8)" />
                </TouchableOpacity>
            </TouchableOpacity>
            {index < list.length - 1 && <View style={[styles.divider, { marginLeft: numbered ? PAGE_GUTTER + 36 : PAGE_GUTTER + 52 + 14, backgroundColor: 'rgba(255,255,255,0.14)' }]} />}
        </View>
    );

    const albumShelf = (heading: string, items: Album[]) => items.length === 0 ? null : (
        <View style={styles.shelf}>
            <SectionHeading title={heading} c={c} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelfRow}>
                {items.map(item => (
                    <TouchableOpacity key={`${heading}-${item.id}`} style={styles.shelfCard} onPress={() => openAlbum(item)} onLongPress={() => songMenu({ kind: 'album', album: item }, navigation)} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={item.title}>
                        <Image source={{ uri: API.getCoverUrl(item.cover, 320) }} style={[styles.shelfArt, { backgroundColor: c.surfaceVariant, borderColor: c.thumbnailBorder }]} />
                        <Text style={[GX_TYPE.titleMedium, styles.shelfTitle, { color: c.onBackground }]} numberOfLines={1}>{item.title}</Text>
                        <Text style={[GX_TYPE.bodyMedium, { color: c.onSurfaceVariant }]} numberOfLines={1}>{[releaseKind(item, singles), item.releaseDate?.slice(0, 4)].filter(Boolean).join(' · ')}</Text>
                    </TouchableOpacity>
                ))}
            </ScrollView>
        </View>
    );

    const skeleton = (
        <SkeletonPulse style={styles.skeleton}>
            {[0, 1, 2, 3, 4].map(item => (
                <View key={item} style={styles.songRow}>
                    <View style={[styles.rowArt, { borderWidth: 0, backgroundColor: c.surfaceVariant }]} />
                    <View style={styles.rowCopy}>
                        <View style={[styles.skeletonTitle, { backgroundColor: c.surfaceVariant }]} />
                        <View style={[styles.skeletonMeta, { backgroundColor: c.surfaceVariant }]} />
                    </View>
                </View>
            ))}
        </SkeletonPulse>
    );

    const columnWidth = trackColumnWidth(width);
    const topColumns: Track[][] = [];
    for (let i = 0; i < tracks.length; i += SONGS_PER_COLUMN) topColumns.push(tracks.slice(i, i + SONGS_PER_COLUMN));

    return (
        <View style={[styles.root, { backgroundColor: c.background }]}>
            {tintArt ? (
                <View style={StyleSheet.absoluteFill} pointerEvents="none">
                    <Image source={{ uri: tintArt }} style={StyleSheet.absoluteFill} blurRadius={80} />
                    <View style={[StyleSheet.absoluteFill, isArtist ? styles.artistTint : styles.tint]} />
                </View>
            ) : null}
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
                {isArtist && !tintArt && background}
                {isArtist && tintArt && (
                    <View style={[styles.pageBackground, { height: artHeight }]} pointerEvents="none">
                        <MaskedView style={StyleSheet.absoluteFill} maskElement={<LinearGradient colors={['#000000', '#000000', 'transparent']} locations={[0, 0.6, 1]} style={StyleSheet.absoluteFill} />}>
                            <Image source={{ uri: tintArt.replace('/320x320', '/1280x1280') }} style={StyleSheet.absoluteFill} />
                        </MaskedView>
                    </View>
                )}
                {isArtist ? (
                    <>
                        {/* ArtistHeader: name sits on the photo's foot. */}
                        <View style={{ height: artHeight + HEADER_DROP - ARTIST_HEADER_LIFT, justifyContent: 'flex-end' }}>
                            <Text style={[GX_TYPE.displayLarge, styles.artistName, { color: c.onBackground }]} numberOfLines={2}>{title}</Text>
                        </View>
                        <View style={styles.artistActions}>
                            <CircleIconButton icon="shuffle" label="Shuffle" onPress={shuffle} size={ARTIST_SIDE_BUTTON} c={c} />
                            <TouchableOpacity style={styles.playCircle} onPress={() => play(0)} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Play">
                                <Ionicons name="play" size={ARTIST_PLAY_BUTTON * 0.48} color="#000000" style={styles.playGlyph} />
                            </TouchableOpacity>
                            <CircleIconButton icon="star-outline" label="Follow" onPress={() => {}} size={ARTIST_SIDE_BUTTON} enabled={false} c={c} />
                        </View>
                        {loading ? skeleton : (
                            <>
                                {latest && (
                                    <TouchableOpacity style={styles.recentCard} onPress={() => openAlbum(latest)} onLongPress={() => songMenu({ kind: 'album', album: latest }, navigation)} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={latest.title}>
                                        <Image source={{ uri: API.getCoverUrl(latest.cover, 320) }} style={styles.recentArt} />
                                        <View style={styles.rowCopy}>
                                            <Text style={[GX_TYPE.bodyLarge, styles.dim]} numberOfLines={1}>{[releaseKind(latest, singles), latest.releaseDate?.slice(0, 4)].filter(Boolean).join(' · ')}</Text>
                                            <Text style={[GX_TYPE.headlineMedium, styles.white]} numberOfLines={1}>{latest.title}</Text>
                                            <Text style={[GX_TYPE.bodyLarge, styles.dim]} numberOfLines={1}>{`Recent ${releaseKind(latest, singles)}`}</Text>
                                        </View>
                                    </TouchableOpacity>
                                )}
                                {tracks.length > 0 && (
                                    <View>
                                        <SectionHeading title="Top songs" c={c} />
                                        <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={columnWidth + 12} decelerationRate="fast" contentContainerStyle={styles.topSongs}>
                                            {topColumns.map((column, columnIndex) => (
                                                <View key={`col-${columnIndex}`} style={{ width: columnWidth }}>
                                                    {column.map((track, rowIndex) => (
                                                        <TouchableOpacity key={track.id} style={styles.compactRow} onPress={() => play(columnIndex * SONGS_PER_COLUMN + rowIndex)} onLongPress={() => songMenu({ kind: 'track', track }, navigation)} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={`Play ${track.title}`}>
                                                            <Image source={{ uri: API.getCoverUrl(track.album?.cover, 140) }} style={[styles.compactArt, { backgroundColor: c.surfaceVariant, borderColor: c.thumbnailBorder }]} />
                                                            <View style={styles.rowCopy}>
                                                                <Text style={[GX_TYPE.titleMedium, { color: isCurrent(track) ? PLAYING_ACCENT : c.onBackground }]} numberOfLines={1}>{track.title}</Text>
                                                                <Text style={[GX_TYPE.bodyMedium, styles.dim]} numberOfLines={1}>{track.artists?.map(a => a.name).join(', ') || track.artist?.name}</Text>
                                                            </View>
                                                            <TouchableOpacity onPress={() => songMenu({ kind: 'track', track }, navigation)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`More for ${track.title}`}>
                                                                <Ionicons name="ellipsis-vertical" size={20} color="rgba(255,255,255,0.8)" />
                                                            </TouchableOpacity>
                                                        </TouchableOpacity>
                                                    ))}
                                                </View>
                                            ))}
                                        </ScrollView>
                                    </View>
                                )}
                                {albumShelf('Singles & EPs', singles)}
                                {albumShelf('Albums', albums)}
                            </>
                        )}
                    </>
                ) : (
                    <>
                        {/* ReleaseHeader */}
                        <View style={[styles.releaseHeader, { paddingTop: insets.top + 56 }]}>
                            <View style={[styles.sleeve, { width: sleeve, height: sleeve, backgroundColor: c.surfaceVariant, borderColor: c.thumbnailBorder }]}>
                                {art ? <Image source={{ uri: art }} style={StyleSheet.absoluteFill} /> : <MaterialCommunityIcons name={collection?.icon ?? 'music-note'} size={sleeve * 0.28} color="rgba(255,255,255,0.18)" />}
                            </View>
                            <Text style={[GX_TYPE.headlineMedium, styles.releaseTitle, { color: c.onBackground }]} numberOfLines={2}>{title}</Text>
                            {!!credit && (
                                <TouchableOpacity disabled={!album?.artist?.id} onPress={() => openArtist(album?.artist?.id, album?.artist)} accessibilityRole="button">
                                    <Text style={[GX_TYPE.titleLarge, styles.credit, { color: 'rgba(255,255,255,0.72)' }]} numberOfLines={1}>{credit}</Text>
                                </TouchableOpacity>
                            )}
                            {!!meta && <Text style={[GX_TYPE.labelMedium, styles.meta, { color: 'rgba(255,255,255,0.72)' }]} numberOfLines={1}>{meta}</Text>}
                            {tracks.length > 0 && (
                                <View style={styles.releaseActions}>
                                    <CircleIconButton icon="shuffle" label="Shuffle" onPress={shuffle} size={RELEASE_SIDE_BUTTON} c={c} />
                                    <TouchableOpacity style={styles.playPill} onPress={() => play(0)} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Play">
                                        <Ionicons name="play" size={18} color="#000000" />
                                        <Text style={[GX_TYPE.titleMedium, styles.playPillText]}>Play</Text>
                                    </TouchableOpacity>
                                    <CircleIconButton icon="add" label="Add to library" onPress={() => {}} size={RELEASE_SIDE_BUTTON} enabled={false} c={c} />
                                </View>
                            )}
                        </View>
                        {loading ? skeleton : (reversed ? tracks.slice().reverse() : tracks).map((track, index, list) => songRow(track, index, !isPlaylist, list))}
                        {!!album?.copyright && <Text style={[GX_TYPE.labelMedium, styles.copyright, { color: c.onSurfaceVariant }]}>{album.copyright}</Text>}
                        {albumShelf(`More by ${album?.artist?.name || 'this artist'}`, moreByArtist)}
                    </>
                )}
            </ScrollView>

            {/* Floating back button over the art */}
            <BackCircle style={[styles.back, { top: insets.top + 6 }]} />
            {isArtist && (
                <View style={[glassStyles.capsule, styles.topCapsule, { top: insets.top + 6 }]}>
                    <TouchableOpacity style={glassStyles.capsuleButton} onPress={() => { Share.share({ message: title }); }} accessibilityRole="button" accessibilityLabel="Share">
                        <Ionicons name="share-outline" size={26} color="#FFFFFF" />
                    </TouchableOpacity>
                    <TouchableOpacity style={glassStyles.capsuleButton} onPress={() => navigation.navigate('Library', { screen: 'Settings' })} accessibilityRole="button" accessibilityLabel="Profile">
                        <View style={glassStyles.capsuleAvatar}><Ionicons name="person" size={20} color="rgba(255,255,255,0.8)" /></View>
                    </TouchableOpacity>
                </View>
            )}
            {collection && (
                <View style={[glassStyles.capsule, styles.topCapsule, { top: insets.top + 6 }]}>
                    <TouchableOpacity style={glassStyles.capsuleButton} onPress={() => setReversed(r => !r)} accessibilityRole="button" accessibilityLabel="Sort">
                        <Ionicons name="filter" size={24} color="#FFFFFF" />
                    </TouchableOpacity>
                    <TouchableOpacity style={glassStyles.capsuleButton} onPress={() => navigation.navigate('Settings')} accessibilityRole="button" accessibilityLabel="Profile">
                        <View style={glassStyles.capsuleAvatar}><Ionicons name="person" size={20} color="rgba(255,255,255,0.8)" /></View>
                    </TouchableOpacity>
                </View>
            )}
            {!isArtist && !collection && (
                <View style={[glassStyles.capsule, styles.topCapsule, { top: insets.top + 6 }]}>
                    <TouchableOpacity style={glassStyles.capsuleButton} onPress={() => navigation.navigate('Search' as never)} accessibilityRole="button" accessibilityLabel="Search">
                        <Ionicons name="search" size={24} color="#FFFFFF" />
                    </TouchableOpacity>
                    <TouchableOpacity style={glassStyles.capsuleButton} onPress={() => setReversed(r => !r)} accessibilityRole="button" accessibilityLabel="Sort">
                        <Ionicons name="filter" size={24} color="#FFFFFF" />
                    </TouchableOpacity>
                    <TouchableOpacity style={glassStyles.capsuleButton} onPress={() => album && songMenu({ kind: 'album', album }, navigation)} accessibilityRole="button" accessibilityLabel="More">
                        <Ionicons name="ellipsis-horizontal" size={24} color="#FFFFFF" />
                    </TouchableOpacity>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    flex: { flex: 1 },
    content: { paddingBottom: 160 },
    pageBackground: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
    topCapsule: { position: 'absolute', right: PAGE_GUTTER },
    tint: { backgroundColor: 'rgba(0,0,0,0.5)' },
    artistTint: { backgroundColor: 'rgba(0,0,0,0.28)' },
    duration: { color: 'rgba(255,255,255,0.72)', marginRight: 14 },
    back: { position: 'absolute', left: PAGE_GUTTER },
    recentCard: { flexDirection: 'row', alignItems: 'center', marginHorizontal: PAGE_GUTTER, marginBottom: 12, padding: 14, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
    recentArt: { width: 112, height: 112, borderRadius: 12 },
    white: { color: '#FFFFFF' },
    dim: { color: 'rgba(255,255,255,0.72)' },
    releaseHeader: { alignItems: 'center', paddingBottom: 18 },
    sleeve: {
        borderRadius: 12, borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
        shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 18,
    },
    releaseTitle: { textAlign: 'center', paddingHorizontal: HEADER_GUTTER, marginTop: 20 },
    credit: { fontFamily: 'SFProDisplay-Regular', fontSize: 19, lineHeight: 24, textAlign: 'center', paddingHorizontal: HEADER_GUTTER, marginTop: 2 },
    meta: { lineHeight: 20, textAlign: 'center', paddingHorizontal: HEADER_GUTTER, marginTop: 4 },
    releaseActions: { flexDirection: 'row', alignItems: 'center', gap: RELEASE_ACTION_GAP, width: '100%', maxWidth: 420, paddingHorizontal: HEADER_GUTTER, marginTop: 18 },
    circleButton: { alignItems: 'center', justifyContent: 'center', backgroundColor: `rgba(255,255,255,${LIGHT_FILL_ALPHA})`, borderWidth: 1, borderColor: `rgba(255,255,255,${EDGE_ALPHA})` },
    playPill: { flex: 1, height: RELEASE_SIDE_BUTTON, borderRadius: RELEASE_SIDE_BUTTON / 2, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 24 },
    playPillText: { color: '#000000' },
    artistName: { textAlign: 'center', paddingHorizontal: HEADER_GUTTER, paddingTop: 14, paddingBottom: 7 },
    artistActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: ARTIST_ACTION_GAP, paddingHorizontal: HEADER_GUTTER, marginTop: 8, marginBottom: 22 },
    playCircle: { width: ARTIST_PLAY_BUTTON, height: ARTIST_PLAY_BUTTON, borderRadius: ARTIST_PLAY_BUTTON / 2, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
    playGlyph: { marginLeft: 4 },
    sectionHeading: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: PAGE_GUTTER, paddingVertical: 10 },
    topSongs: { paddingHorizontal: PAGE_GUTTER, gap: 12 },
    compactRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
    compactArt: { width: 48, height: 48, borderRadius: 7, borderWidth: 1 },
    songRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: PAGE_GUTTER, paddingVertical: 8 },
    trackNumber: { width: 36 },
    rowArt: { width: 52, height: 52, borderRadius: 8, borderWidth: 1 },
    rowCopy: { flex: 1, minWidth: 0, marginLeft: 14, marginRight: 8 },
    divider: { height: 0.5 },
    copyright: { paddingHorizontal: PAGE_GUTTER, paddingTop: 18 },
    shelf: { paddingTop: 22 },
    shelfRow: { paddingHorizontal: PAGE_GUTTER, gap: 14 },
    shelfCard: { width: SHELF_CARD_WIDTH },
    shelfArt: { width: SHELF_CARD_WIDTH, height: SHELF_CARD_WIDTH, borderRadius: 12, borderWidth: 1 },
    shelfTitle: { marginTop: 10 },
    skeleton: { paddingTop: 8 },
    skeletonTitle: { width: '62%', height: 12, borderRadius: 6 },
    skeletonMeta: { width: '38%', height: 10, borderRadius: 5, marginTop: 8 },
});
