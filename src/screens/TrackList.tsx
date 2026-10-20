import { haptic } from '../services/haptics';
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ProfileCircle } from '../components/GlassHeader';
import { useSongMenu } from '../components/SongMenu';
import { searchSuggestions as ytSearchSuggestions } from '../services/ytmusic';
import { addSearchHistory, clearSearchHistory, getSearchHistory, removeSearchHistory } from '../store/searchHistory';
import {
    View, Text, TextInput, TouchableOpacity, Image,
    StyleSheet, ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { API } from '../api';
import type { Album, Artist, Playlist, Track } from '../types';
import { usePlayerSummary } from '../context/PlayerContext';
import { useTheme } from '../context/ThemeContext';
import { getListeningProfile, topArtists } from '../store/listeningProfile';
import { getPrefs } from '../store/preferences';
import { getRadioRecommendations } from '../services/recommendations';
import TouchableScale from '../components/TouchableScale';
import SkeletonPulse from '../components/SkeletonPulse';
import { useAppDialog } from '../context/DialogContext';
import { useScreenStatusBar } from '../hooks/useScreenStatusBar';
import { normalizeMusicText } from '../services/musicMatching';
import { GX_DARK, GX_LIGHT, GX_TYPE, PAGE_GUTTER, PLAYING_ACCENT, SHELF_CARD_WIDTH } from '../theme/groovix';

type FilterTab = 'all' | 'songs' | 'albums' | 'artists' | 'playlists';

type SearchSuggestion = {
    key: string;
    label: string;
    subtitle: string;
    query: string;
    kind: 'song' | 'artist' | 'album' | 'history' | 'browse' | 'query';
    cover?: string;
};

const FILTER_TABS: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'songs', label: 'Songs' },
    { key: 'albums', label: 'Albums' },
    { key: 'artists', label: 'Artists' },
    { key: 'playlists', label: 'Playlists' },
];

// Quick genre search suggestions
const QUICK_SEARCHES = [
    { label: 'Global Hits', subtitle: 'Charts across the world', query: 'global trending hits', icon: 'earth-outline' },
    { label: 'Bollywood Now', subtitle: 'Hindi film favourites', query: 'bollywood trending hits', icon: 'film-outline' },
    { label: 'Punjabi Wave', subtitle: 'Fresh Punjabi releases', query: 'punjabi trending', icon: 'radio-outline' },
    { label: 'Made For You', subtitle: 'Matched to your grooves', query: 'personal mix', icon: 'sparkles-outline' },
    { label: 'Hip-Hop', subtitle: 'Rap and new releases', query: 'hip hop latest', icon: 'mic-outline' },
    { label: 'Chill & Focus', subtitle: 'Lofi and easy listening', query: 'lofi chill focus', icon: 'moon-outline' },
    { label: 'Romance', subtitle: 'Hindi and global love songs', query: 'romantic songs hindi english', icon: 'heart-outline' },
    { label: 'Party', subtitle: 'Dance, pop and EDM', query: 'party dance edm hits', icon: 'musical-notes-outline' },
];

function formatCatalogDuration(seconds: number): string {
    if (!seconds) return '';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function normalizeSearchText(value?: string): string {
    return normalizeMusicText(value);
}

function textMatchScore(value: string | undefined, query: string): number {
    const text = normalizeSearchText(value);
    const q = normalizeSearchText(query);
    if (!text || !q) return 0;
    if (text === q) return 100;
    if (text.startsWith(q)) return 70;
    if (text.split(' ').some(word => word.startsWith(q))) return 45;
    if (text.includes(q)) return 30;
    return q.split(' ').filter(word => word.length > 1 && text.includes(word)).length * 6;
}

function rankAndDedupe<T>(items: T[], keyFor: (item: T) => string, scoreFor: (item: T) => number): T[] {
    const seen = new Set<string>();
    return items
        .map((item, index) => ({ item, index, score: scoreFor(item) }))
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .filter(({ item }) => {
            const key = normalizeSearchText(keyFor(item));
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .map(({ item }) => item);
}

function trackSearchScore(track: Track, query: string): number {
    const normalizedQuery = normalizeSearchText(query);
    const exactArtist = normalizeSearchText(track.artist?.name) === normalizedQuery;
    const title = normalizeSearchText(track.title);
    const requestedVariant = /\b(remix|cover|karaoke|instrumental|slowed|sped up|vocals? only)\b/.test(normalizedQuery);
    const alternateVariant = /\b(remix|cover|karaoke|instrumental|slowed|sped up|vocals? only)\b/.test(title);
    return (exactArtist ? 140 : textMatchScore(track.artist?.name, query))
        + (exactArtist ? 0 : textMatchScore(track.title, query) * 2)
        + textMatchScore(track.album?.title, query)
        + Math.min(track.popularity || 0, 100) / 10
        - (!requestedVariant && alternateVariant ? 80 : 0);
}

export default function TrackListScreen() {
    const { playTrack, playFromUpNext, addToQueue, currentTrack, upNext } = usePlayerSummary();
    const { colors, theme } = useTheme();
    const { showDialog } = useAppDialog();

    useScreenStatusBar(theme === 'soundwave' ? 'dark-content' : 'light-content', colors.background);

    // Long-press feedback uses the themed Groovix dialog on every platform.
    const queueTrack = useCallback((track: Track) => {
        addToQueue(track);
        showDialog({ title: 'Added to queue', message: track.title, icon: 'list-outline' });
    }, [addToQueue, showDialog]);
    const [query, setQuery] = useState('');
    const [tracks, setTracks] = useState<Track[]>([]);
    const [albums, setAlbums] = useState<Album[]>([]);
    const [artists, setArtists] = useState<Artist[]>([]);
    const [playlists, setPlaylists] = useState<Playlist[]>([]);
    const [loading, setLoading] = useState(false);
    const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
    const [hasSearched, setHasSearched] = useState(false);
    const [submittedQuery, setSubmittedQuery] = useState('');
    const [searchError, setSearchError] = useState<string | null>(null);
    const [personalTracks, setPersonalTracks] = useState<Track[]>([]);
    const [relatedTracks, setRelatedTracks] = useState<Track[]>([]);
    const [tasteArtists, setTasteArtists] = useState<string[]>([]);
    const [remoteSuggestions, setRemoteSuggestions] = useState<SearchSuggestion[]>([]);
    const [suggestionsLoading, setSuggestionsLoading] = useState(false);
    const searchRequestId = useRef(0);
    const suggestionRequestId = useRef(0);

    const nav = useNavigation<any>();
    const [popularArtists, setPopularArtists] = useState<Artist[]>([]);

    useEffect(() => {
        Promise.all([API.searchArtists('popular artists'), getListeningProfile(), getPrefs()]).then(([artistResults, profile, prefs]) => {
            setPopularArtists(artistResults.slice(0, 24));
            setPersonalTracks([...profile.recentTracks, ...profile.likedTracks].filter((track, index, all) => all.findIndex(item => item.id === track.id) === index).slice(0, 30));
            setTasteArtists([...new Set([...topArtists(profile, 12), ...(prefs?.artists || [])])].slice(0, 20));
        }).catch(() => {});
    }, []);

    const localSuggestions = useMemo<SearchSuggestion[]>(() => {
        const q = query.trim().toLocaleLowerCase();
        if (!q || q === submittedQuery.toLocaleLowerCase()) return [];
        const suggestions: SearchSuggestion[] = [];
        personalTracks.forEach(track => {
            if (`${track.title} ${track.artist?.name || ''}`.toLocaleLowerCase().includes(q)) suggestions.push({
                key: `history-track-${track.id}`,
                label: track.title,
                subtitle: `${track.artist?.name || 'Unknown artist'} · From your grooves`,
                query: `${track.title} ${track.artist?.name || ''}`.trim(),
                kind: 'history',
                cover: track.album?.cover,
            });
        });
        [...tasteArtists, ...popularArtists.map(artist => artist.name)].forEach(name => {
            if (name.toLocaleLowerCase().includes(q)) suggestions.push({
                key: `local-artist-${normalizeSearchText(name)}`,
                label: name,
                subtitle: 'Artist',
                query: name,
                kind: 'artist',
            });
        });
        QUICK_SEARCHES.forEach(item => {
            if (`${item.label} ${item.query}`.toLocaleLowerCase().includes(q)) suggestions.push({
                key: `browse-${item.query}`,
                label: item.label,
                subtitle: item.subtitle,
                query: item.query,
                kind: 'browse',
            });
        });
        return suggestions.slice(0, 6);
    }, [personalTracks, popularArtists, query, submittedQuery, tasteArtists]);

    useEffect(() => {
        const q = query.trim();
        const requestId = ++suggestionRequestId.current;
        if (q.length < 2 || normalizeSearchText(q) === normalizeSearchText(submittedQuery)) {
            setRemoteSuggestions([]);
            setSuggestionsLoading(false);
            return;
        }
        setSuggestionsLoading(true);
        const timer = setTimeout(async () => {
            // typeahead: one YouTube Music completion request per pause in
            // typing, not a full catalogue search per keystroke.
            const completions = await ytSearchSuggestions(q).catch(() => [] as string[]);
            if (requestId !== suggestionRequestId.current) return;
            setRemoteSuggestions(completions.slice(0, 7).map(text => ({
                key: `yt-suggest-${text}`, label: text, subtitle: '', query: text, kind: 'query' as const,
            })));
            setSuggestionsLoading(false);
        }, 300);
        return () => clearTimeout(timer);
    }, [query, submittedQuery]);

    const searchSuggestions = useMemo(() => rankAndDedupe(
        [...remoteSuggestions, ...localSuggestions],
        item => `${item.kind}-${item.label}-${item.subtitle}`,
        item => textMatchScore(item.label, query) + (item.kind === 'history' ? 4 : 0),
    ).slice(0, 8), [localSuggestions, query, remoteSuggestions]);

    const performSearch = useCallback(async (searchQuery?: string) => {
        const q = (searchQuery || query).trim();
        if (!q) return;
        const requestId = ++searchRequestId.current;
        setLoading(true);
        setHasSearched(true);
        setSubmittedQuery(q);
        setSearchError(null);
        setRelatedTracks([]);
        try {
            const results = await API.searchCatalog(q);
            if (requestId !== searchRequestId.current) return;
            const rankedTracks = rankAndDedupe(
                results.tracks,
                track => `${track.title}-${track.artist?.name}-${track.album?.title}`,
                track => trackSearchScore(track, q),
            );
            const rankedAlbums = rankAndDedupe(
                results.albums,
                album => `${album.title}-${album.artist?.name}`,
                album => textMatchScore(album.title, q) * 2 + textMatchScore(album.artist?.name, q),
            );
            const rankedArtists = rankAndDedupe(results.artists, artist => artist.name, artist => textMatchScore(artist.name, q));
            const rankedPlaylists = rankAndDedupe(
                results.playlists,
                playlist => `${playlist.title}-${playlist.creatorName}`,
                playlist => textMatchScore(playlist.title, q) * 2 + textMatchScore(playlist.creatorName, q),
            );
            setTracks(rankedTracks);
            setAlbums(rankedAlbums);
            setArtists(rankedArtists);
            setPlaylists(rankedPlaylists);
            const totalResults = results.tracks.length + results.albums.length + results.artists.length + results.playlists.length;
            if (totalResults === 0) {
                setTracks([]);
                setSearchError(`No matches found for “${q}”`);
            } else {
                setSearchError(null);
                if (results.tracks.length > 0) getRadioRecommendations(rankedTracks[0], new Set(rankedTracks.map(track => track.id)), 30)
                    .then(related => { if (requestId === searchRequestId.current) setRelatedTracks(related); })
                    .catch(() => {});
            }
        } catch (e) {
            console.log('Search error:', e);
            if (requestId === searchRequestId.current) {
                setTracks([]);
                setAlbums([]);
                setArtists([]);
                setPlaylists([]);
                setSearchError('Search is unavailable right now. Please try again.');
            }
        } finally {
            if (requestId === searchRequestId.current) setLoading(false);
        }
    }, [query]);

    // Explore's mood pages hand a playlist over to open here.
    const route = useRoute<any>();
    useEffect(() => {
        const playlist: Playlist | undefined = route.params?.openPlaylist;
        if (!playlist) return;
        nav.setParams({ openPlaylist: undefined });
        void openPlaylist(playlist);
    }, [nav, route.params?.openPlaylist]); // eslint-disable-line react-hooks/exhaustive-deps

    const onQuickSearch = (q: string) => {
        setQuery(q);
        performSearch(q);
    };

    const openPlaylist = useCallback(async (playlist: Playlist) => {
        const requestId = ++searchRequestId.current;
        setLoading(true);
        setSearchError(null);
        try {
            const detail = await API.getPlaylist(playlist.id);
            if (requestId !== searchRequestId.current) return;
            setQuery(playlist.title);
            setSubmittedQuery(playlist.title);
            setTracks(detail.tracks);
            setAlbums([]);
            setArtists([]);
            setPlaylists(detail.playlist ? [detail.playlist] : [playlist]);
            setRelatedTracks([]);
            setActiveFilter('songs');
            setHasSearched(true);
            if (detail.tracks.length === 0) setSearchError('This playlist has no playable tracks right now.');
        } finally {
            if (requestId === searchRequestId.current) setLoading(false);
        }
    }, []);

    const c = theme === 'soundwave' ? GX_LIGHT : GX_DARK;
    const [recentSearches, setRecentSearches] = useState<Track[]>([]);
    const [source, setSource] = useState<'online' | 'library'>('online');
    const inputRef = useRef<TextInput>(null);
    useFocusEffect(useCallback(() => {
        getSearchHistory().then(setRecentSearches);
        // Search opens Search with the field focused.
        const timer = setTimeout(() => inputRef.current?.focus(), 250);
        return () => clearTimeout(timer);
    }, []));
    const songMenu = useSongMenu();
    const playFromSearch = (track: Track) => {
        playTrack(track);
        addSearchHistory(track).then(setRecentSearches).catch(() => {});
    };
    const isCurrent = (track: Track) => currentTrack?.id === track.id;

    const clearSearch = () => {
        searchRequestId.current += 1;
        setQuery(''); setTracks([]); setAlbums([]); setArtists([]); setPlaylists([]); setRelatedTracks([]);
        setSubmittedQuery(''); setHasSearched(false); setSearchError(null); setLoading(false);
    };

    // SongRow: 52dp art, title/artist, more button.
    const renderSongRow = (item: Track, key: string) => (
        <TouchableOpacity key={key} style={styles.row} onPress={() => playFromSearch(item)} onLongPress={() => songMenu({ kind: 'track', track: item }, nav)} delayLongPress={280} activeOpacity={0.7}>
            <Image source={{ uri: API.getCoverUrl(item.album?.cover, 160) }} style={[styles.rowArt, { backgroundColor: c.surfaceVariant, borderColor: c.thumbnailBorder }]} />
            <View style={styles.rowCopy}>
                <Text style={[GX_TYPE.titleMedium, { color: isCurrent(item) ? PLAYING_ACCENT : c.onBackground }]} numberOfLines={1}>{item.title}</Text>
                <Text style={[GX_TYPE.bodyMedium, { color: c.onSurfaceVariant }]} numberOfLines={1}>Song · {item.artist?.name}</Text>
            </View>
            <TouchableOpacity onPress={() => songMenu({ kind: 'track', track: item }, nav)} style={styles.rowMore} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Add ${item.title} to queue`}>
                <Ionicons name="ellipsis-horizontal" size={20} color={c.onSurfaceVariant} />
            </TouchableOpacity>
        </TouchableOpacity>
    );

    // BrowseRow: circle art for artists, rounded for the rest.
    const renderBrowseRow = (key: string, title: string, subtitle: string, image: string | undefined, circle: boolean, onPress: () => void) => (
        <TouchableOpacity key={key} style={styles.row} onPress={onPress} activeOpacity={0.7}>
            <Image source={{ uri: API.getCoverUrl(image, 160) }} style={[styles.rowArt, { borderRadius: circle ? 26 : 8, backgroundColor: c.surfaceVariant, borderColor: c.thumbnailBorder }]} />
            <View style={styles.rowCopy}>
                <Text style={[GX_TYPE.titleMedium, { color: c.onBackground }]} numberOfLines={1}>{title}</Text>
                <Text style={[GX_TYPE.bodyMedium, { color: c.onSurfaceVariant }]} numberOfLines={1}>{subtitle}</Text>
            </View>
        </TouchableOpacity>
    );

    const divider = (key: string) => <View key={key} style={[styles.divider, { backgroundColor: c.outline }]} />;

    const withDividers = (nodes: React.ReactNode[], prefix: string) =>
        nodes.flatMap((node, index) => index < nodes.length - 1 ? [node, divider(`${prefix}-div-${index}`)] : [node]);

    const openArtist = (artist: Artist) => nav.navigate('AlbumDetail', { artistId: artist.id, artistData: artist });
    const openAlbum = (album: Album) => { if (album.id) nav.navigate('AlbumDetail', { albumId: album.id, albumData: album }); };

    const albumRows = albums.map(album => renderBrowseRow(`album-${album.id}`, album.title,
        ['Album', album.artist?.name, album.releaseDate?.slice(0, 4)].filter(Boolean).join(' · '), album.cover, false, () => openAlbum(album)));
    const artistRows = artists.map(artist => renderBrowseRow(`artist-${artist.id}`, artist.name, 'Artist', artist.picture, true, () => openArtist(artist)));
    const playlistRows = playlists.map(playlist => renderBrowseRow(`playlist-${playlist.id}`, playlist.title,
        ['Playlist', playlist.creatorName, `${playlist.numberOfTracks} songs`, formatCatalogDuration(playlist.duration)].filter(Boolean).join(' · '), playlist.cover, false, () => nav.navigate('AlbumDetail', { playlistId: playlist.id, playlistData: playlist })));

    const sectionTitle = (title: string) => (
        <Text key={`section-${title}`} style={[GX_TYPE.titleSmall, styles.sectionTitle, { color: c.onSurface }]}>{title}</Text>
    );

    const topResult = tracks[0];

    const renderTopResult = (track: Track) => (
        <View style={styles.topResult}>
            <Text style={[GX_TYPE.titleSmall, { color: c.onSurface }]}>Top result</Text>
            <TouchableOpacity style={styles.topRow} onPress={() => playFromSearch(track)} onLongPress={() => songMenu({ kind: 'track', track }, nav)} activeOpacity={0.8}>
                <Image source={{ uri: API.getCoverUrl(track.album?.cover, 240) }} style={[styles.topArt, { backgroundColor: c.surfaceVariant }]} />
                <View style={styles.rowCopy}>
                    <Text style={[GX_TYPE.titleLarge, { color: c.onSurface }]} numberOfLines={2}>{track.title}</Text>
                    <Text style={[GX_TYPE.bodyMedium, styles.topArtist, { color: c.onSurfaceVariant }]} numberOfLines={1}>{track.artist?.name}</Text>
                </View>
                <TouchableOpacity onPress={() => songMenu({ kind: 'track', track }, nav)} hitSlop={8} accessibilityRole="button" accessibilityLabel="More">
                    <Ionicons name="ellipsis-horizontal" size={24} color={c.onSurface} />
                </TouchableOpacity>
            </TouchableOpacity>
            <View style={styles.topButtons}>
                <TouchableOpacity style={[styles.outlined, { borderColor: c.outline }]} onPress={() => playFromSearch(track)} accessibilityRole="button">
                    <Ionicons name="play" size={18} color={c.onSurface} />
                    <Text style={[GX_TYPE.titleSmall, { color: c.onSurface }]}>Play</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.outlined, { borderColor: c.outline }]} onPress={() => queueTrack(track)} accessibilityRole="button">
                    <Ionicons name="add" size={20} color={c.onSurface} />
                    <Text style={[GX_TYPE.titleSmall, { color: c.onSurface }]}>Queue</Text>
                </TouchableOpacity>
            </View>
        </View>
    );

    const skeleton = (
        <SkeletonPulse style={styles.skeletonGroup}>
            {[0, 1, 2, 3, 4, 5].map(item => (
                <View key={item} style={styles.row}>
                    <View style={[styles.rowArt, { borderWidth: 0, backgroundColor: c.surfaceVariant, borderRadius: activeFilter === 'artists' ? 26 : 8 }]} />
                    <View style={styles.rowCopy}>
                        <View style={[styles.skeletonTitle, { backgroundColor: c.surfaceVariant }]} />
                        <View style={[styles.skeletonMeta, { backgroundColor: c.surfaceVariant }]} />
                    </View>
                </View>
            ))}
        </SkeletonPulse>
    );

    const renderContent = () => {
        if (loading && source === 'online') return skeleton;

        // Suggestions while typing (searchSuggestions + typeahead).
        if (source === 'online' && query.trim() && query.trim().toLocaleLowerCase() !== submittedQuery.toLocaleLowerCase()) {
            return (
                <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.listContent}>
                    <TouchableOpacity style={styles.suggestionRow} onPress={() => onQuickSearch(query.trim())} accessibilityRole="button">
                        <Ionicons name="search" size={20} color={c.onSurfaceVariant} />
                        <Text style={[GX_TYPE.bodyLarge, styles.suggestionText, { color: c.onBackground }]} numberOfLines={1}>{query.trim()}</Text>
                    </TouchableOpacity>
                    {searchSuggestions.map(suggestion => suggestion.cover || suggestion.kind === 'artist' ? (
                        renderBrowseRow(suggestion.key, suggestion.label, suggestion.subtitle, suggestion.cover, suggestion.kind === 'artist', () => onQuickSearch(suggestion.query))
                    ) : (
                        <View key={suggestion.key} style={styles.suggestionRow}>
                            <TouchableOpacity style={styles.suggestionMain} onPress={() => onQuickSearch(suggestion.query)} accessibilityRole="button" accessibilityLabel={`Search for ${suggestion.label}`}>
                                <Ionicons name={suggestion.kind === 'history' ? 'time-outline' : 'search'} size={20} color={c.onSurfaceVariant} />
                                <Text style={[GX_TYPE.bodyLarge, styles.suggestionText, { color: c.onBackground }]} numberOfLines={1}>{suggestion.label}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => setQuery(suggestion.query)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Fill ${suggestion.label}`}>
                                <Ionicons name="arrow-up-outline" size={20} color={c.onSurfaceVariant} style={styles.fillArrow} />
                            </TouchableOpacity>
                        </View>
                    ))}
                    {suggestionsLoading && skeleton}
                </ScrollView>
            );
        }

        // Library source: filter what is already on this phone.
        if (source === 'library' && query.trim()) {
            const q = normalizeSearchText(query);
            const local = rankAndDedupe(
                [...recentSearches, ...personalTracks],
                track => `${track.id}`,
                track => trackSearchScore(track, query),
            ).filter(track => normalizeSearchText(`${track.title} ${track.artist?.name || ''} ${track.album?.title || ''}`).includes(q));
            return local.length === 0
                ? <Text style={[GX_TYPE.bodyMedium, styles.message, { color: c.onSurfaceVariant }]}>Nothing in your library matches “{query.trim()}”</Text>
                : <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.listContent}>{local.map(track => renderSongRow(track, `local-${track.id}`))}</ScrollView>;
        }

        // Nothing submitted: Recent searches.
        if (!hasSearched) {
            return (
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
                    {recentSearches.length > 0 ? (
                        <>
                            <View style={styles.recentHeader}>
                                <Text style={[GX_TYPE.headlineMedium, styles.flexText, { color: c.onBackground }]}>Recent searches</Text>
                                <TouchableOpacity onPress={() => clearSearchHistory().then(setRecentSearches)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear recent searches">
                                    <Text style={[GX_TYPE.titleMedium, { color: c.onBackground }]}>Clear</Text>
                                </TouchableOpacity>
                            </View>
                            {recentSearches.map(track => (
                                <TouchableOpacity key={`recent-${track.id}`} style={styles.recentRow} onPress={() => playFromSearch(track)} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={`Play ${track.title}`}>
                                    <Image source={{ uri: API.getCoverUrl(track.album?.cover, 160) }} style={[styles.recentArt, { backgroundColor: c.surfaceVariant }]} />
                                    <View style={styles.rowCopy}>
                                        <Text style={[GX_TYPE.titleMedium, { color: isCurrent(track) ? PLAYING_ACCENT : c.onBackground }]} numberOfLines={1}>{track.title}</Text>
                                        <Text style={[GX_TYPE.bodyMedium, { color: c.onSurfaceVariant }]} numberOfLines={1}>{track.artists?.map(a => a.name).join(', ') || track.artist?.name}</Text>
                                    </View>
                                    <TouchableOpacity onPress={() => removeSearchHistory(track.id).then(setRecentSearches)} style={styles.rowMore} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${track.title} from recent searches`}>
                                        <Ionicons name="close" size={24} color={c.onSurfaceVariant} />
                                    </TouchableOpacity>
                                </TouchableOpacity>
                            ))}
                        </>
                    ) : (
                        <Text style={[GX_TYPE.bodyMedium, styles.message, { color: c.onSurfaceVariant }]}>Search for songs, albums and artists</Text>
                    )}
                </ScrollView>
            );
        }

        const totalResults = tracks.length + albums.length + artists.length + playlists.length;
        if (totalResults === 0) {
            return <Text style={[GX_TYPE.bodyMedium, styles.message, { color: c.onSurfaceVariant }]}>{searchError || 'No results found'}</Text>;
        }

        const songs = (activeFilter === 'all' ? tracks.slice(1, 6) : tracks).map(track => renderSongRow(track, `song-${track.id}`));
        const body: React.ReactNode[] = [];
        if (activeFilter === 'all') {
            if (topResult) body.push(<View key="top">{renderTopResult(topResult)}</View>);
            if (songs.length) body.push(sectionTitle('Songs'), ...withDividers(songs, 'songs'));
            if (artistRows.length) body.push(sectionTitle('Artists'), ...withDividers(artistRows.slice(0, 4), 'artists'));
            if (albumRows.length) body.push(sectionTitle('Albums'), ...withDividers(albumRows.slice(0, 4), 'albums'));
            if (playlistRows.length) body.push(sectionTitle('Playlists'), ...withDividers(playlistRows.slice(0, 4), 'playlists'));
        } else {
            const rows = activeFilter === 'songs' ? songs : activeFilter === 'albums' ? albumRows : activeFilter === 'artists' ? artistRows : playlistRows;
            if (rows.length === 0) return <Text style={[GX_TYPE.bodyMedium, styles.message, { color: c.onSurfaceVariant }]}>No results for “{submittedQuery}”</Text>;
            body.push(...withDividers(rows, activeFilter));
        }
        if (relatedTracks.length > 0 && (activeFilter === 'all' || activeFilter === 'songs')) {
            body.push(
                <View key="related" style={styles.relatedSection}>
                    <Text style={[GX_TYPE.headlineMedium, styles.relatedTitle, { color: c.onBackground }]}>Similar to {submittedQuery}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelfRow}>
                        {relatedTracks.map(item => (
                            <TouchableOpacity key={`related-${item.id}`} style={styles.shelfCard} onPress={() => playTrack(item)} activeOpacity={0.82} accessibilityRole="button" accessibilityLabel={`Play ${item.title}`}>
                                <Image source={{ uri: API.getCoverUrl(item.album?.cover, 320) }} style={[styles.shelfArt, { backgroundColor: c.surfaceVariant, borderColor: c.thumbnailBorder }]} />
                                <Text style={[GX_TYPE.titleMedium, styles.shelfTitle, { color: c.onBackground }]} numberOfLines={1}>{item.title}</Text>
                                <Text style={[GX_TYPE.bodyMedium, { color: c.onSurfaceVariant }]} numberOfLines={1}>{item.artist?.name}</Text>
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                </View>,
            );
        }
        return <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.listContent}>{body}</ScrollView>;
    };

    return (
        <SafeAreaView style={[styles.root, { backgroundColor: c.background }]} edges={['top']}>
            <View style={styles.searchHeader}>
            {/* SearchField beside the glass profile circle */}
            <View style={[styles.searchField, { backgroundColor: c.surfaceVariant }]}>
                <TouchableOpacity onPress={() => performSearch()} disabled={!query.trim()} style={styles.searchIcon} accessibilityRole="button" accessibilityLabel="Search">
                    <Ionicons name="search" size={20} color={c.onSurfaceVariant} />
                </TouchableOpacity>
                <TextInput
                    ref={inputRef}
                    style={[GX_TYPE.bodyLarge, styles.searchInput, { color: c.onBackground }]}
                    placeholder="Artists, Songs, Lyrics and More"
                    placeholderTextColor={c.onSurfaceVariant}
                    selectionColor={c.primary}
                    value={query}
                    onChangeText={(text) => {
                        setQuery(text);
                        if (!text.trim()) clearSearch();
                    }}
                    onSubmitEditing={() => { if (source === 'online') performSearch(); }}
                    returnKeyType="search"
                />
                {query.length > 0 && (
                    <TouchableOpacity onPress={clearSearch} style={styles.clearButton} accessibilityRole="button" accessibilityLabel="Clear search">
                        <Ionicons name="close" size={18} color={c.onSurfaceVariant} />
                    </TouchableOpacity>
                )}
            </View>

            <ProfileCircle />
            </View>

            {/* source switcher */}
            {!query.trim() || source === 'library' || !hasSearched ? (
                <View style={[styles.sourceSwitch, { backgroundColor: c.surfaceVariant }]}>
                    {([['online', 'Online'], ['library', 'Library']] as const).map(([id, label]) => {
                        const selected = source === id;
                        return (
                            <TouchableOpacity key={id} style={[styles.sourceOption, selected && { backgroundColor: '#FFFFFF' }]} onPress={() => setSource(id)} accessibilityRole="button" accessibilityState={{ selected }}>
                                <Text style={[GX_TYPE.titleMedium, { color: selected ? '#000000' : c.onSurfaceVariant }]}>{label}</Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>
            ) : null}

            {/* SearchFilterTabs: 12dp-corner pills, selected inverted */}
            {hasSearched && query.trim().toLocaleLowerCase() === submittedQuery.toLocaleLowerCase() && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterRow}>
                    {FILTER_TABS.map(tab => {
                        const selected = activeFilter === tab.key;
                        return (
                            <TouchableOpacity
                                key={tab.key}
                                style={[styles.filterPill, { backgroundColor: selected ? c.onBackground : c.surfaceVariant }]}
                                onPress={() => { haptic('select'); setActiveFilter(tab.key); }}
                                activeOpacity={0.8}
                                accessibilityRole="button"
                                accessibilityState={{ selected }}
                            >
                                <Text style={[GX_TYPE.titleSmall, styles.filterLabel, { color: selected ? c.background : c.onBackground }]}>{tab.label}</Text>
                            </TouchableOpacity>
                        );
                    })}
                </ScrollView>
            )}

            {renderContent()}
        </SafeAreaView>
    );
}

const MOOD_COLORS = ['#C2410C', '#7C3AED', '#0F766E', '#BE185D', '#1D4ED8', '#4D7C0F', '#B91C1C', '#A16207'];

const styles = StyleSheet.create({
    root: { flex: 1 },
    searchHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: PAGE_GUTTER, paddingTop: 4, paddingBottom: 14 },
    sourceSwitch: { flexDirection: 'row', marginHorizontal: PAGE_GUTTER, borderRadius: 16, padding: 4, marginBottom: 8 },
    sourceOption: { flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    recentRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: PAGE_GUTTER, paddingVertical: 8 },
    recentArt: { width: 56, height: 56, borderRadius: 8 },
    flexText: { flex: 1 },
    searchField: { flex: 1, height: 46, borderRadius: 11, paddingLeft: 8, paddingRight: 12, flexDirection: 'row', alignItems: 'center' },
    searchIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginRight: 4 },
    searchInput: { flex: 1, padding: 0 },
    clearButton: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    filterScroll: { flexGrow: 0 },
    filterRow: { paddingHorizontal: PAGE_GUTTER, paddingVertical: 6, gap: 8, alignItems: 'center' },
    filterPill: { paddingVertical: 6, borderRadius: 12, paddingHorizontal: 12, justifyContent: 'center' },
    filterLabel: { includeFontPadding: false, textAlignVertical: 'center' },
    listContent: { paddingBottom: 160 },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: PAGE_GUTTER, paddingVertical: 6 },
    rowArt: { width: 52, height: 52, borderRadius: 8, borderWidth: 1 },
    rowCopy: { flex: 1, minWidth: 0, marginLeft: 14 },
    rowMore: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    divider: { height: 0.5, marginLeft: PAGE_GUTTER + 68 },
    sectionTitle: { paddingHorizontal: PAGE_GUTTER, paddingTop: 16, paddingBottom: 6 },
    topResult: { paddingHorizontal: PAGE_GUTTER, paddingTop: 18, paddingBottom: 8 },
    topRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
    topArt: { width: 72, height: 72, borderRadius: 10 },
    topArtist: { marginTop: 4 },
    topButtons: { flexDirection: 'row', gap: 10, marginTop: 12 },
    outlined: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 20, borderRadius: 20, borderWidth: 1 },
    suggestionRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: PAGE_GUTTER, minHeight: 52 },
    suggestionMain: { flex: 1, flexDirection: 'row', alignItems: 'center' },
    suggestionText: { flex: 1, marginLeft: 16 },
    fillArrow: { transform: [{ rotate: '-45deg' }] },
    recentHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: PAGE_GUTTER, paddingTop: 18, paddingBottom: 8 },
    message: { textAlign: 'center', paddingHorizontal: 32, paddingTop: 48 },
    moodGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: PAGE_GUTTER, gap: 12 },
    moodCard: { width: '47.8%', aspectRatio: 1.6, borderRadius: 12, padding: 12, overflow: 'hidden' },
    moodTitle: { color: '#FFFFFF' },
    moodIcon: { position: 'absolute', right: 10, bottom: 10, transform: [{ rotate: '18deg' }] },
    relatedSection: { paddingTop: 16 },
    relatedTitle: { paddingHorizontal: PAGE_GUTTER, paddingVertical: 10 },
    shelfRow: { paddingHorizontal: PAGE_GUTTER, gap: 14 },
    shelfCard: { width: SHELF_CARD_WIDTH },
    shelfArt: { width: SHELF_CARD_WIDTH, height: SHELF_CARD_WIDTH, borderRadius: 12, borderWidth: 1 },
    shelfTitle: { marginTop: 10 },
    skeletonGroup: { paddingTop: 8 },
    skeletonTitle: { width: '62%', height: 12, borderRadius: 6 },
    skeletonMeta: { width: '38%', height: 10, borderRadius: 5, marginTop: 8 },
});
