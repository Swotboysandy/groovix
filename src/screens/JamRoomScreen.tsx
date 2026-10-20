import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
    View, Text, TextInput, StyleSheet,
    FlatList, Share,
    ScrollView, Image, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useJam, type JamTrack, type ChatMessage } from '../context/JamContext';
import { usePlayer } from '../context/PlayerContext';

// Mini-player overlay height (from PlayerWidget) — used to lift the FAB above it.
const MINI_PLAYER_H = 58;
import { API } from '../api';
import { createJamInviteLink } from '../services/jamLinks';
import type { Album, Artist, Playlist, Track } from '../types';
import TouchableScale from '../components/TouchableScale';
import DraggableBottomSheet from '../components/DraggableBottomSheet';
import SkeletonPulse from '../components/SkeletonPulse';
import { useAppDialog } from '../context/DialogContext';
import { useScreenStatusBar } from '../hooks/useScreenStatusBar';
import { useTheme } from '../context/ThemeContext';
import type { ThemeColors } from '../theme';
import { getListeningProfile } from '../store/listeningProfile';
import { ACCENT_RED, GX_DARK, GX_LIGHT, GX_TYPE, PAGE_GUTTER, PLAYING_ACCENT } from '../theme/groovix';

// Keep every Jam control on the same Reanimated press-feedback path as the
// player. This includes queue rows, votes, sync, chat, search, and the FAB.
const TouchableOpacity = TouchableScale;

const ACCENT = '#7c5cfc';
const ACCENT2 = '#fa2d48';

const SEARCH_FILTERS = [
    { id: 'top', label: 'Top', icon: 'trending-up-outline', queries: ['global top songs', 'India top songs'] },
    { id: 'hindi', label: 'Hindi', icon: 'language-outline', queries: ['Hindi hits', 'new Hindi songs'] },
    { id: 'punjabi', label: 'Punjabi', icon: 'musical-notes-outline', queries: ['Punjabi hits', 'new Punjabi songs'] },
    { id: 'bollywood', label: 'Bollywood', icon: 'film-outline', queries: ['Bollywood hits', 'Bollywood dance songs'] },
    { id: 'global', label: 'Global', icon: 'earth-outline', queries: ['global hits', 'viral songs'] },
    { id: 'pop', label: 'Pop', icon: 'sparkles-outline', queries: ['pop hits', 'new pop songs'] },
    { id: 'hiphop', label: 'Hip-Hop', icon: 'mic-outline', queries: ['hip hop hits', 'new rap songs'] },
    { id: 'rnb', label: 'R&B', icon: 'heart-outline', queries: ['R&B hits', 'new R&B songs'] },
    { id: 'chill', label: 'Chill', icon: 'moon-outline', queries: ['chill songs', 'acoustic chill'] },
] as const;

const RESULT_FILTERS = [
    { id: 'songs', label: 'Songs', icon: 'musical-note-outline' },
    { id: 'artists', label: 'Artists', icon: 'person-outline' },
    { id: 'albums', label: 'Albums', icon: 'albums-outline' },
    { id: 'playlists', label: 'Playlists', icon: 'list-outline' },
    { id: 'liked', label: 'Liked', icon: 'heart-outline' },
] as const;

type ResultFilter = typeof RESULT_FILTERS[number]['id'];

type JamStyles = ReturnType<typeof createStyles>;

interface QueueRowProps {
    item: JamTrack;
    index: number;
    playing: boolean;
    myVote: boolean;
    canRemove: boolean;
    canPlay: boolean;
    onPlay: (id: string) => void;
    onVote: (id: string) => void;
    onRemove: (id: string) => void;
    styles: JamStyles;
    colors: ThemeColors;
    accent: string;
}

// Memoized so the list stays smooth — a row only re-renders when its own props change.
const QueueRow = React.memo(function QueueRow({
    item, index, playing, myVote, canRemove, canPlay, onPlay, onVote, onRemove,
    styles, colors, accent,
}: QueueRowProps) {
    const cover = API.getCoverUrl(item.track.album?.cover, 80);
    return (
        <TouchableOpacity
            style={[styles.queueCard, playing && styles.queueCardPlaying]}
            onPress={canPlay ? () => onPlay(item.id) : undefined}
            activeOpacity={canPlay ? 0.8 : 1}
        >
            <View style={styles.rank}>
                {playing
                    ? <Ionicons name="volume-medium" size={17} color={accent} />
                    : <Text style={styles.rankText}>{index + 1}</Text>}
            </View>

            {cover ? (
                <Image source={{ uri: cover }} style={styles.cover} />
            ) : (
                <View style={[styles.cover, styles.coverFallback]}>
                    <Ionicons name="musical-note" size={18} color={colors.textSecondary} />
                </View>
            )}

            <View style={styles.trackInfo}>
                <Text style={[styles.trackTitle, playing && styles.trackTitlePlaying]} numberOfLines={1}>{item.track.title}</Text>
                <Text style={styles.trackArtist} numberOfLines={1}>{item.track.artist?.name}</Text>
                <Text style={styles.addedBy}>added by {item.addedBy}</Text>
            </View>

            <TouchableOpacity
                style={[styles.voteBtn, myVote && styles.voteBtnActive]}
                onPress={() => onVote(item.id)}
                activeOpacity={0.7}
            >
                <Ionicons name={myVote ? 'thumbs-up' : 'thumbs-up-outline'} size={16} color={myVote ? '#fff' : colors.textMuted} />
                <Text style={[styles.voteCount, myVote && styles.voteCountActive]}>{item.votes}</Text>
            </TouchableOpacity>

            {canRemove && (
                <TouchableOpacity style={styles.removeBtn} onPress={() => onRemove(item.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
            )}
        </TouchableOpacity>
    );
});

export default function JamRoomScreen() {
    const insets = useSafeAreaInsets();
    const { theme, colors } = useTheme();
    const accent = theme === 'soundwave' ? colors.primary : ACCENT;
    const styles = useMemo(() => createStyles(colors, accent, theme === 'soundwave'), [colors, accent, theme]);
    useScreenStatusBar(theme === 'soundwave' ? 'dark-content' : 'light-content', colors.background);
    const {
        room, myName, isHost, isConnected, leaveRoom, addToQueue, addLikedToQueue, vote, removeFromQueue,
        sortedQueue, messages, sendChat, nowPlaying, behind, playNow, skipNext, syncToRoom,
    } = useJam();
    const { currentTrack, isPlaying, togglePlayPause } = usePlayer();
    const { showDialog } = useAppDialog();

    // When a song is playing, the mini-player overlays the bottom — lift the FAB above it.
    const fabBottom = (currentTrack ? MINI_PLAYER_H : 0) + 16;

    const [showSearch, setShowSearch] = useState(false);
    const [showChat, setShowChat] = useState(false);
    const [chatInput, setChatInput] = useState('');
    const [seenCount, setSeenCount] = useState(0);
    const chatListRef = useRef<FlatList>(null);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<Track[]>([]);
    const [artists, setArtists] = useState<Artist[]>([]);
    const [albums, setAlbums] = useState<Album[]>([]);
    const [playlists, setPlaylists] = useState<Playlist[]>([]);
    const [likedTracks, setLikedTracks] = useState<Track[]>([]);
    const [searching, setSearching] = useState(false);
    const [activeFilter, setActiveFilter] = useState('top');
    const [resultFilter, setResultFilter] = useState<ResultFilter>('songs');
    const [addedTrackIds, setAddedTrackIds] = useState<Set<number>>(new Set());
    const searchRequestRef = useRef(0);

    // Unread badge: messages seen up to the moment chat is open; stays cleared while open.
    const openChat = useCallback(() => { setShowChat(true); setSeenCount(messages.length); }, [messages.length]);
    useEffect(() => { if (showChat) setSeenCount(messages.length); }, [showChat, messages.length]);
    const unread = Math.max(0, messages.length - seenCount);

    const handleLeave = () => {
        showDialog({
            title: 'Leave room?',
            message: 'You will stop sharing playback with the room.',
            icon: 'exit-outline',
            actions: [
                { text: 'Stay', tone: 'neutral' },
                { text: 'Leave', tone: 'destructive', onPress: leaveRoom },
            ],
        });
    };

    const handleShare = () => {
        if (!room) return;
        const link = createJamInviteLink(room.slug);
        Share.share({ message: `Join my Groovix JAM: ${link}\nRoom code: ${room.slug}` });
    };

    const commitResults = useCallback((requestId: number, tracks: Track[]) => {
        if (requestId !== searchRequestRef.current) return;
        const seen = new Set<number>();
        const uniqueTracks = tracks.filter(track => {
            if (seen.has(track.id)) return false;
            seen.add(track.id);
            return true;
        });
        setResults(uniqueTracks.slice(0, 40));
        setSearching(false);
    }, []);

    const doSearch = useCallback(async (q: string) => {
        if (!q.trim()) { setResults([]); setArtists([]); setAlbums([]); setPlaylists([]); return; }
        const requestId = ++searchRequestRef.current;
        setActiveFilter('search');
        setSearching(true);
        try {
            const catalog = await API.searchCatalog(q);
            if (requestId !== searchRequestRef.current) return;
            setArtists(catalog.artists.slice(0, 30));
            setAlbums(catalog.albums.slice(0, 30));
            setPlaylists(catalog.playlists.slice(0, 30));
            commitResults(requestId, catalog.tracks);
        } catch {
            if (requestId === searchRequestRef.current) {
                setArtists([]);
                setAlbums([]);
                setPlaylists([]);
            }
            commitResults(requestId, []);
        } finally {
            if (requestId === searchRequestRef.current) setSearching(false);
        }
    }, [commitResults]);

    const browseFilter = useCallback(async (filterId: string) => {
        const filter = SEARCH_FILTERS.find(item => item.id === filterId) ?? SEARCH_FILTERS[0];
        const requestId = ++searchRequestRef.current;
        setActiveFilter(filter.id);
        setResultFilter('songs');
        setQuery('');
        setArtists([]);
        setAlbums([]);
        setPlaylists([]);
        setSearching(true);
        try {
            const groups = await Promise.all(filter.queries.map(search => API.search(search)));
            commitResults(requestId, groups.flat());
        } catch {
            commitResults(requestId, []);
        }
    }, [commitResults]);

    const onQueryChange = (q: string) => {
        setQuery(q);
        if (resultFilter === 'liked') return;
        if (searchTimeout.current) clearTimeout(searchTimeout.current);
        if (!q.trim()) {
            browseFilter(activeFilter === 'search' ? 'top' : activeFilter);
            return;
        }
        searchTimeout.current = setTimeout(() => doSearch(q), 350);
    };

    const selectResultFilter = useCallback((filter: ResultFilter) => {
        setResultFilter(filter);
        if (filter === 'liked') {
            setActiveFilter('search');
            setQuery('');
            getListeningProfile().then(profile => setLikedTracks(profile.likedTracks));
        }
    }, []);

    useEffect(() => {
        if (showSearch && results.length === 0 && !searching) browseFilter('top');
    }, [showSearch]);
    useEffect(() => {
        if (showChat && messages.length > 0) {
            setTimeout(() => chatListRef.current?.scrollToEnd({ animated: true }), 80);
        }
    }, [messages, showChat]);

    const handleSendChat = () => {
        const t = chatInput.trim();
        if (!t) return;
        sendChat(t);
        setChatInput('');
    };

    const searchTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleAdd = (track: Track) => {
        if (addedTrackIds.has(track.id)) return;
        addToQueue(track);
        setAddedTrackIds(previous => new Set(previous).add(track.id));
    };

    const filteredLikedTracks = useMemo(() => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return likedTracks;
        return likedTracks.filter(track => `${track.title} ${track.artist?.name || ''} ${track.album?.title || ''}`.toLowerCase().includes(normalized));
    }, [likedTracks, query]);

    const handlePlayLiked = useCallback(() => {
        addLikedToQueue(filteredLikedTracks);
        setAddedTrackIds(new Set(filteredLikedTracks.map(track => track.id)));
        setShowSearch(false);
    }, [addLikedToQueue, filteredLikedTracks]);

    const showArtistSongs = useCallback((artist: Artist) => {
        setResultFilter('songs');
        setQuery(artist.name);
        doSearch(artist.name);
    }, [doSearch]);

    const showAlbumSongs = useCallback(async (album: Album) => {
        const requestId = ++searchRequestRef.current;
        setResultFilter('songs');
        setQuery(album.title);
        setActiveFilter('search');
        setSearching(true);
        try {
            const detail = await API.getAlbum(album.id);
            commitResults(requestId, detail.tracks);
        } catch {
            commitResults(requestId, []);
        }
    }, [commitResults]);

    const showPlaylistSongs = useCallback(async (playlist: Playlist) => {
        const requestId = ++searchRequestRef.current;
        setResultFilter('songs');
        setQuery(playlist.title);
        setActiveFilter('search');
        setSearching(true);
        try {
            const detail = await API.getPlaylist(playlist.id);
            commitResults(requestId, detail.tracks);
        } catch {
            commitResults(requestId, []);
        }
    }, [commitResults]);

    const closeSearch = () => {
        searchRequestRef.current += 1;
        setShowSearch(false);
        setQuery('');
        setResults([]);
        setArtists([]);
        setAlbums([]);
        setPlaylists([]);
        setLikedTracks([]);
        setActiveFilter('top');
        setResultFilter('songs');
        setAddedTrackIds(new Set());
    };

    // Only the host (DJ) changes what the room plays; everyone else votes + syncs.
    // Stable per-id callbacks so the memoized rows don't re-render every poll.
    const handlePlayId = useCallback((id: string) => { if (isHost) playNow(id); }, [isHost, playNow]);
    const handleVoteId = useCallback((id: string) => vote(id), [vote]);
    const handleRemoveId = useCallback((id: string) => removeFromQueue(id), [removeFromQueue]);

    if (!room) return null;

    const playingId = nowPlaying?.track.id;
    const renderQueueItem = ({ item, index }: { item: JamTrack; index: number }) => (
        <QueueRow
            item={item}
            index={index}
            playing={playingId === item.track.id}
            myVote={item.voters.includes(myName)}
            canRemove={isHost || item.addedBy === myName}
            canPlay={isHost}
            onPlay={handlePlayId}
            onVote={handleVoteId}
            onRemove={handleRemoveId}
            styles={styles}
            colors={colors}
            accent={accent}
        />
    );

    const bc = theme === 'soundwave' ? GX_LIGHT : GX_DARK;
    const divider = <View style={[partyStyles.divider, { backgroundColor: bc.outline }]} />;
    const group = (header: string | null, footer: string | null, children: React.ReactNode) => (
        <View>
            {header ? <Text style={[GX_TYPE.labelSmall, partyStyles.groupHeader, { color: bc.onSurfaceVariant }]}>{header.toUpperCase()}</Text> : <View style={partyStyles.groupSpacer} />}
            <View style={[partyStyles.group, { backgroundColor: bc.surfaceVariant }]}>{children}</View>
            {footer ? <Text style={[GX_TYPE.bodyMedium, partyStyles.groupFooter, { color: bc.onSurfaceVariant }]}>{footer}</Text> : null}
        </View>
    );
    const row = (icon: string, title: string, subtitle: string | null, onPress: (() => void) | null, trailing?: React.ReactNode, tint?: string) => (
        <TouchableOpacity style={partyStyles.row} onPress={onPress ?? undefined} disabled={!onPress} activeOpacity={0.6} accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={title}>
            <Ionicons name={icon} size={22} color={tint ?? bc.onBackground} />
            <View style={partyStyles.rowCopy}>
                <Text style={[GX_TYPE.bodyLarge, { color: tint ?? bc.onBackground }]} numberOfLines={1}>{title}</Text>
                {subtitle ? <Text style={[GX_TYPE.bodyMedium, { color: bc.onSurfaceVariant }]}>{subtitle}</Text> : null}
            </View>
            {trailing ?? (onPress ? <Ionicons name="chevron-forward" size={20} color={bc.onSurfaceVariant} style={{ opacity: 0.7 }} /> : null)}
        </TouchableOpacity>
    );
    const badge = (text: string) => <Text style={[GX_TYPE.labelSmall, partyStyles.badge]}>{text.toUpperCase()}</Text>;
    // connection line under the heading.
    const connection = !isConnected ? 'Reconnecting…' : behind ? 'Out of sync — tap Sync to catch up' : 'In sync with the party';

    return (
        <View style={[partyStyles.screen, { backgroundColor: bc.background, paddingTop: insets.top }]}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: fabBottom + 140 }}>
                <Text style={[GX_TYPE.displayLarge, partyStyles.title, { color: bc.onBackground }]}>Listen together</Text>
                <View style={partyStyles.connection}>
                    <View style={[partyStyles.dot, { backgroundColor: isConnected && !behind ? '#4CAF50' : '#FF9F0A' }]} />
                    <Text style={[GX_TYPE.bodyMedium, { color: bc.onSurfaceVariant }]}>{connection}</Text>
                </View>

                {/* InAParty: the code, big and centred */}
                {group('Party code', 'Read it out or send it. Anyone with the code can join.', (
                    <>
                        <Text style={[partyStyles.code, { color: bc.onBackground }]} selectable>{room.slug}</Text>
                        {divider}
                        {row('share-outline', 'Share invite', 'Send a link that opens this party', handleShare)}
                    </>
                ))}

                {/* Now playing in the party */}
                {group('Now playing', null, nowPlaying ? (
                    <View style={partyStyles.nowRow}>
                        <Image source={{ uri: API.getCoverUrl(nowPlaying.track.album?.cover, 160) }} style={partyStyles.nowArt} />
                        <View style={partyStyles.rowCopy}>
                            <Text style={[GX_TYPE.titleMedium, { color: bc.onBackground }]} numberOfLines={1}>{nowPlaying.track.title}</Text>
                            <Text style={[GX_TYPE.bodyMedium, { color: bc.onSurfaceVariant }]} numberOfLines={1}>{nowPlaying.track.artist?.name}</Text>
                        </View>
                        {isHost ? (
                            <View style={partyStyles.hostControls}>
                                <TouchableOpacity onPress={togglePlayPause} hitSlop={8} accessibilityLabel={isPlaying ? 'Pause' : 'Play'}>
                                    <Ionicons name={isPlaying ? 'pause' : 'play'} size={26} color={bc.onBackground} />
                                </TouchableOpacity>
                                <TouchableOpacity onPress={skipNext} hitSlop={8} accessibilityLabel="Skip">
                                    <Ionicons name="play-forward" size={24} color={bc.onBackground} />
                                </TouchableOpacity>
                            </View>
                        ) : behind ? (
                            <TouchableOpacity onPress={syncToRoom} style={[partyStyles.syncPill, { backgroundColor: bc.primary }]} accessibilityRole="button">
                                <Ionicons name="sync" size={14} color={bc.onPrimary} />
                                <Text style={[GX_TYPE.labelMedium, { color: bc.onPrimary }]}>Sync</Text>
                            </TouchableOpacity>
                        ) : (
                            <View style={partyStyles.live}><View style={partyStyles.liveDot} /><Text style={[GX_TYPE.labelSmall, { color: bc.onSurfaceVariant }]}>LIVE</Text></View>
                        )}
                    </View>
                ) : isHost && sortedQueue.length > 0
                    ? row('play-circle', 'Start playing the queue', null, () => playNow(sortedQueue[0].id))
                    : row('musical-notes', 'Nothing playing yet', null, null))}

                {/* Members */}
                {group(`Listening · ${room.participants.length}`, 'Only the host changes what plays; everyone can add songs and vote.', (
                    <>
                        {room.participants.map((name, index) => (
                            <View key={name}>
                                <View style={partyStyles.row}>
                                    <View style={[partyStyles.avatar, { backgroundColor: bc.outline }]}>
                                        <Text style={[GX_TYPE.labelMedium, { color: bc.onBackground }]}>{name.charAt(0).toUpperCase()}</Text>
                                    </View>
                                    <View style={[partyStyles.rowCopy, partyStyles.memberLine]}>
                                        <Text style={[GX_TYPE.bodyLarge, { color: bc.onBackground }]} numberOfLines={1}>{name}</Text>
                                        {name === myName ? badge('You') : null}
                                        {index === 0 ? badge('Host') : null}
                                    </View>
                                </View>
                                {index < room.participants.length - 1 && divider}
                            </View>
                        ))}
                    </>
                ))}

                {/* Party queue, by votes */}
                {group(`Up next${sortedQueue.length ? ` · ${sortedQueue.length}` : ''}`, 'Sorted by votes. Tap the thumb to vote a song up.', (
                    <>
                        {sortedQueue.map((item, index) => {
                            const playing = playingId === item.track.id;
                            const myVote = item.voters.includes(myName);
                            return (
                                <View key={item.id}>
                                    <TouchableOpacity style={partyStyles.row} onPress={isHost ? () => handlePlayId(item.id) : undefined} disabled={!isHost} activeOpacity={0.7}>
                                        <Image source={{ uri: API.getCoverUrl(item.track.album?.cover, 120) }} style={partyStyles.queueArt} />
                                        <View style={partyStyles.rowCopy}>
                                            <Text style={[GX_TYPE.titleMedium, { color: playing ? PLAYING_ACCENT : bc.onBackground }]} numberOfLines={1}>{item.track.title}</Text>
                                            <Text style={[GX_TYPE.bodyMedium, { color: bc.onSurfaceVariant }]} numberOfLines={1}>{item.track.artist?.name} · added by {item.addedBy}</Text>
                                        </View>
                                        <TouchableOpacity onPress={() => handleVoteId(item.id)} style={[partyStyles.vote, myVote && { backgroundColor: bc.primary }]} accessibilityLabel={myVote ? 'Remove vote' : 'Vote up'}>
                                            <Ionicons name={myVote ? 'thumbs-up' : 'thumbs-up-outline'} size={14} color={myVote ? bc.onPrimary : bc.onSurfaceVariant} />
                                            <Text style={[GX_TYPE.labelMedium, { color: myVote ? bc.onPrimary : bc.onSurfaceVariant }]}>{item.votes}</Text>
                                        </TouchableOpacity>
                                        {(isHost || item.addedBy === myName) && (
                                            <TouchableOpacity onPress={() => handleRemoveId(item.id)} style={partyStyles.remove} hitSlop={6} accessibilityLabel={`Remove ${item.track.title}`}>
                                                <Ionicons name="close" size={18} color={bc.onSurfaceVariant} />
                                            </TouchableOpacity>
                                        )}
                                    </TouchableOpacity>
                                    {index < sortedQueue.length - 1 && divider}
                                </View>
                            );
                        })}
                        {sortedQueue.length > 0 && divider}
                        {row('add-circle', 'Add to queue', 'Search songs or add your liked songs', () => { setAddedTrackIds(new Set()); setShowSearch(true); })}
                    </>
                ))}

                {group(null, null, (
                    <>
                        {row('chatbubble-ellipses', 'Chat', messages.length ? `${messages.length} messages` : 'Say hi to the party', openChat, unread > 0 ? (
                            <View style={[partyStyles.unread, { backgroundColor: ACCENT_RED }]}><Text style={[GX_TYPE.labelSmall, { color: '#FFFFFF' }]}>{unread > 9 ? '9+' : unread}</Text></View>
                        ) : undefined)}
                        {divider}
                        {row('exit-outline', 'Leave party', 'Stop sharing playback with the party', handleLeave, <View />, '#FF453A')}
                    </>
                ))}
            </ScrollView>

            {/* search drawer */}
            <DraggableBottomSheet
                visible={showSearch}
                onClose={closeSearch}
                sheetStyle={styles.jamDrawer}
                backdropLabel="Close add to queue drawer"
            >
                <View style={styles.modal}>
                    <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>Add to queue</Text>
                        <TouchableOpacity onPress={closeSearch}>
                            <Ionicons name="close" size={22} color={colors.textMuted} />
                        </TouchableOpacity>
                    </View>

                    <View style={styles.searchRow}>
                        <Ionicons name="search" size={18} color={colors.textMuted} />
                        <TextInput
                            style={styles.searchInput}
                            placeholder="Search songs..."
                            placeholderTextColor={colors.textSecondary}
                            value={query}
                            onChangeText={onQueryChange}
                        />
                        {query.length > 0 && (
                            <TouchableOpacity onPress={() => browseFilter('top')}>
                                <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                            </TouchableOpacity>
                        )}
                    </View>

                    <View style={styles.resultFilterList}>
                        {RESULT_FILTERS.filter(filter => isHost || filter.id !== 'liked').map(filter => {
                            const selected = resultFilter === filter.id;
                            return (
                                <TouchableOpacity
                                    key={filter.id}
                                    style={[styles.resultFilterChip, selected && styles.resultFilterChipActive]}
                                    onPress={() => selectResultFilter(filter.id)}
                                    accessibilityRole="button"
                                    accessibilityState={{ selected }}
                                >
                                    <Ionicons name={filter.icon} size={14} color={selected ? '#fff' : colors.textMuted} />
                                    <Text style={[styles.resultFilterText, selected && styles.filterTextActive]}>{filter.label}</Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>

                    {!query.trim() && resultFilter === 'songs' && (
                        <View style={styles.filterList}>
                            {SEARCH_FILTERS.map(filter => {
                                const selected = activeFilter === filter.id;
                                return (
                                    <TouchableOpacity
                                        key={filter.id}
                                        style={[styles.filterChip, selected && styles.filterChipActive]}
                                        onPress={() => browseFilter(filter.id)}
                                        accessibilityRole="button"
                                        accessibilityState={{ selected }}
                                    >
                                        <Ionicons name={filter.icon} size={14} color={selected ? '#fff' : colors.textMuted} />
                                        <Text style={[styles.filterText, selected && styles.filterTextActive]}>{filter.label}</Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                    )}

                    <View style={styles.resultsHeader}>
                        <Text style={styles.resultsTitle}>
                            {activeFilter === 'search'
                                ? `${RESULT_FILTERS.find(item => item.id === resultFilter)?.label ?? 'Songs'} results`
                                : `${SEARCH_FILTERS.find(item => item.id === activeFilter)?.label ?? 'Top'} songs`}
                        </Text>
                        <Text style={styles.resultsCount}>{(
                            resultFilter === 'songs' ? results.length
                                : resultFilter === 'artists' ? artists.length
                                    : resultFilter === 'albums' ? albums.length
                                        : resultFilter === 'playlists' ? playlists.length
                                            : filteredLikedTracks.length
                        ) > 0 ? `${resultFilter === 'songs' ? results.length : resultFilter === 'artists' ? artists.length : resultFilter === 'albums' ? albums.length : resultFilter === 'playlists' ? playlists.length : filteredLikedTracks.length} found` : ''}</Text>
                    </View>

                    {isHost && resultFilter === 'liked' && filteredLikedTracks.length > 0 && (
                        <TouchableOpacity style={styles.playLikedButton} onPress={handlePlayLiked} accessibilityRole="button" accessibilityLabel="Queue and play liked songs">
                            <Ionicons name="play" size={17} color="#fff" />
                            <Text style={styles.playLikedText}>Play liked songs</Text>
                        </TouchableOpacity>
                    )}

                    {searching && (
                        <SkeletonPulse style={styles.searchSkeletonGroup}>
                            {[0, 1, 2].map(item => (
                                <View key={item} style={styles.searchSkeletonRow}>
                                    <View style={styles.searchSkeletonCover} />
                                    <View style={styles.searchSkeletonCopy}>
                                        <View style={styles.searchSkeletonTitle} />
                                        <View style={styles.searchSkeletonMeta} />
                                    </View>
                                </View>
                            ))}
                        </SkeletonPulse>
                    )}

                    <FlatList
                        data={(resultFilter === 'songs' ? results : resultFilter === 'artists' ? artists : resultFilter === 'albums' ? albums : resultFilter === 'playlists' ? playlists : filteredLikedTracks) as Array<Track | Artist | Album | Playlist>}
                        keyExtractor={(item, i) => `${resultFilter}-${item.id}-${i}`}
                        renderItem={({ item }) => {
                            if (resultFilter === 'artists') {
                                const artist = item as Artist;
                                const cover = API.getCoverUrl(artist.picture, 80);
                                return (
                                    <TouchableOpacity style={styles.resultRow} onPress={() => showArtistSongs(artist)} activeOpacity={0.7}>
                                        {cover ? <Image source={{ uri: cover }} style={[styles.resultCover, styles.artistResultCover]} /> : <View style={[styles.resultCover, styles.artistResultCover, styles.coverFallback]}><Ionicons name="person" size={16} color={colors.textSecondary} /></View>}
                                        <View style={styles.resultInfo}><Text style={styles.resultTitle} numberOfLines={1}>{artist.name}</Text><Text style={styles.resultArtist}>View songs by this artist</Text></View>
                                        <Ionicons name="chevron-forward" size={20} color={accent} />
                                    </TouchableOpacity>
                                );
                            }
                            if (resultFilter === 'albums' || resultFilter === 'playlists') {
                                const isAlbum = resultFilter === 'albums';
                                const collection = item as Album | Playlist;
                                const cover = API.getCoverUrl(collection.cover, 80);
                                const subtitle = isAlbum
                                    ? `${(collection as Album).artist?.name || 'Various artists'} · Album`
                                    : `${(collection as Playlist).numberOfTracks || 0} songs · Playlist`;
                                return (
                                    <TouchableOpacity style={styles.resultRow} onPress={() => isAlbum ? showAlbumSongs(collection as Album) : showPlaylistSongs(collection as Playlist)} activeOpacity={0.7}>
                                        {cover ? <Image source={{ uri: cover }} style={styles.resultCover} /> : <View style={[styles.resultCover, styles.coverFallback]}><Ionicons name={isAlbum ? 'albums' : 'list'} size={16} color={colors.textSecondary} /></View>}
                                        <View style={styles.resultInfo}><Text style={styles.resultTitle} numberOfLines={1}>{collection.title}</Text><Text style={styles.resultArtist} numberOfLines={1}>{subtitle}</Text></View>
                                        <Ionicons name="chevron-forward" size={20} color={accent} />
                                    </TouchableOpacity>
                                );
                            }
                            const track = item as Track;
                            const cover = API.getCoverUrl(track.album?.cover, 80);
                            const added = addedTrackIds.has(track.id);
                            return (
                                <TouchableOpacity
                                    style={[styles.resultRow, added && styles.resultRowAdded]}
                                    onPress={() => handleAdd(track)}
                                    disabled={added}
                                    activeOpacity={0.7}
                                >
                                    {cover ? (
                                        <Image source={{ uri: cover }} style={styles.resultCover} />
                                    ) : (
                                        <View style={[styles.resultCover, styles.coverFallback]}>
                                            <Ionicons name="musical-note" size={14} color={colors.textSecondary} />
                                        </View>
                                    )}
                                    <View style={styles.resultInfo}>
                                        <Text style={styles.resultTitle} numberOfLines={1}>{track.title}</Text>
                                        <Text style={styles.resultArtist} numberOfLines={1}>{track.artist?.name}</Text>
                                    </View>
                                    <Ionicons name={added ? 'checkmark-circle' : 'add-circle-outline'} size={22} color={added ? '#4caf50' : accent} />
                                </TouchableOpacity>
                            );
                        }}
                        contentContainerStyle={{ paddingBottom: 40 }}
                        keyboardShouldPersistTaps="handled"
                        ListEmptyComponent={
                            !searching ? (
                                <View style={styles.searchEmpty}>
                                    <Ionicons name="search-outline" size={30} color={colors.textSecondary} />
                                    <Text style={styles.emptyText}>No {RESULT_FILTERS.find(item => item.id === resultFilter)?.label.toLowerCase()} found</Text>
                                    <Text style={styles.emptySubText}>
                                        {resultFilter === 'liked'
                                            ? 'Like songs in the player first, then add them here.'
                                            : query.trim() ? 'Try another search.' : 'Search to browse artists, albums and playlists.'}
                                    </Text>
                                </View>
                            ) : null
                        }
                    />
                </View>
            </DraggableBottomSheet>

            {/* chat drawer */}
            <DraggableBottomSheet visible={showChat} onClose={() => setShowChat(false)} sheetStyle={styles.jamDrawer} backdropLabel="Close chat drawer">
                <KeyboardAvoidingView
                    style={styles.modal}
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                >
                    {/* header */}
                    <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>Chat</Text>
                        <TouchableOpacity onPress={() => setShowChat(false)}>
                            <Ionicons name="close" size={22} color={colors.textMuted} />
                        </TouchableOpacity>
                    </View>

                    {/* messages */}
                    <FlatList
                        ref={chatListRef}
                        data={messages}
                        keyExtractor={m => m.id}
                        contentContainerStyle={{ padding: 16, paddingBottom: 8, flexGrow: 1 }}
                        showsVerticalScrollIndicator={false}
                        ListEmptyComponent={
                            <View style={styles.chatEmpty}>
                                <Ionicons name="chatbubbles-outline" size={36} color={colors.textSecondary} />
                                <Text style={styles.chatEmptyText}>No messages yet</Text>
                                <Text style={styles.chatEmptySubText}>Say something to the room!</Text>
                            </View>
                        }
                        renderItem={({ item }: { item: ChatMessage }) => {
                            const isMe = item.sender === myName;
                            return (
                                <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
                                    {!isMe && (
                                        <Text style={styles.bubbleSender}>{item.sender}</Text>
                                    )}
                                    <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>
                                        {item.text}
                                    </Text>
                                </View>
                            );
                        }}
                    />

                    {/* input */}
                    <View style={[styles.chatInputRow, { paddingBottom: insets.bottom + 12 }]}>
                        <TextInput
                            style={styles.chatInput}
                            placeholder="Type a message..."
                            placeholderTextColor={colors.textSecondary}
                            value={chatInput}
                            onChangeText={setChatInput}
                            onSubmitEditing={handleSendChat}
                            returnKeyType="send"
                            multiline={false}
                        />
                        <TouchableOpacity
                            style={[styles.sendBtn, !chatInput.trim() && styles.sendBtnDisabled]}
                            onPress={handleSendChat}
                            disabled={!chatInput.trim()}
                            activeOpacity={0.7}
                        >
                            <Ionicons name="send" size={18} color="#fff" />
                        </TouchableOpacity>
                    </View>
                </KeyboardAvoidingView>
            </DraggableBottomSheet>
        </View>
    );
}

const createStyles = (colors: ThemeColors, accent: string, isLight: boolean) => StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },

    topBar: {
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 16, paddingVertical: 12,
    },
    backBtn: { padding: 4 },
    shareBtn: { padding: 4, position: 'relative' },
    chatBadge: {
        position: 'absolute', top: 0, right: 0,
        backgroundColor: ACCENT2, borderRadius: 8,
        minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center',
        paddingHorizontal: 3,
    },
    chatBadgeText: { fontFamily: 'Inter-Bold', fontSize: 9, color: '#fff' },

    chatEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 60 },
    chatEmptyText: { fontFamily: 'Inter-SemiBold', fontSize: 15, color: colors.text },
    chatEmptySubText: { fontFamily: 'Inter-Regular', fontSize: 13, color: colors.textMuted },

    bubble: {
        maxWidth: '78%', padding: 10, paddingHorizontal: 14,
        borderRadius: 18, marginBottom: 8,
    },
    bubbleMe: {
        alignSelf: 'flex-end',
        backgroundColor: accent,
        borderBottomRightRadius: 4,
    },
    bubbleThem: {
        alignSelf: 'flex-start',
        backgroundColor: colors.surfaceHover,
        borderBottomLeftRadius: 4,
    },
    bubbleSender: {
        fontFamily: 'Inter-SemiBold', fontSize: 11,
        color: colors.textMuted, marginBottom: 3,
    },
    bubbleText: { fontFamily: 'Inter-Regular', fontSize: 14, color: colors.text },
    bubbleTextMe: { color: '#fff' },

    chatInputRow: {
        flexDirection: 'row', alignItems: 'center', gap: 10,
        paddingHorizontal: 16, paddingTop: 10,
        borderTopWidth: 0.5, borderTopColor: colors.border,
    },
    chatInput: {
        flex: 1, fontFamily: 'Inter-Regular', fontSize: 15,
        color: colors.text, backgroundColor: colors.surfaceHover,
        borderRadius: 22, paddingHorizontal: 16, paddingVertical: 11,
        borderWidth: 1, borderColor: colors.border,
    },
    sendBtn: {
        width: 42, height: 42, borderRadius: 21,
        backgroundColor: accent, alignItems: 'center', justifyContent: 'center',
    },
    sendBtnDisabled: { backgroundColor: isLight ? colors.textSecondary : 'rgba(124,92,252,0.3)' },
    roomInfo: { flex: 1, alignItems: 'center', gap: 4 },
    codePill: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: isLight ? colors.surfaceActive : 'rgba(124,92,252,0.15)',
        paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20,
    },
    dot: { width: 7, height: 7, borderRadius: 4 },
    codeText: { fontFamily: 'Inter-Bold', fontSize: 15, color: accent, letterSpacing: 2 },
    participantsText: { fontFamily: 'Inter-Regular', fontSize: 12, color: colors.textMuted },

    participantsRow: { maxHeight: 44, marginBottom: 4 },
    participantChip: {
        paddingHorizontal: 12, paddingVertical: 6,
        backgroundColor: colors.surfaceHover, borderRadius: 20,
    },
    participantChipMe: { backgroundColor: isLight ? colors.surfaceActive : 'rgba(124,92,252,0.2)', borderWidth: 1, borderColor: colors.borderActive },
    participantText: { fontFamily: 'Inter-Regular', fontSize: 12, color: colors.textMuted },
    participantTextMe: { color: accent, fontFamily: 'Inter-SemiBold' },

    sectionHeader: {
        flexDirection: 'row', alignItems: 'baseline', gap: 8,
        paddingHorizontal: 16, paddingVertical: 12,
    },
    sectionTitle: { fontFamily: 'Inter-Bold', fontSize: 18, color: colors.text },
    sectionSub: { fontFamily: 'Inter-Regular', fontSize: 12, color: colors.textMuted },

    // now playing / sync bar
    npBar: {
        flexDirection: 'row', alignItems: 'center', gap: 12,
        marginHorizontal: 16, marginTop: 8, marginBottom: 2,
        padding: 10, borderRadius: 18,
        backgroundColor: isLight ? colors.surface : 'rgba(124,92,252,0.13)',
        borderWidth: 1, borderColor: isLight ? colors.border : 'rgba(124,92,252,0.28)',
    },
    npCover: { width: 50, height: 50, borderRadius: 12, backgroundColor: colors.surfaceHover },
    npInfo: { flex: 1 },
    npLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
    npLabel: { fontFamily: 'Inter-Bold', fontSize: 9, letterSpacing: 1, color: accent },
    npTitle: { fontFamily: 'Inter-SemiBold', fontSize: 14.5, color: colors.text },
    npArtist: { fontFamily: 'Inter-Regular', fontSize: 12, color: colors.textMuted, marginTop: 1 },
    npControls: { flexDirection: 'row', alignItems: 'center' },
    npCtrlBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    syncPill: {
        flexDirection: 'row', alignItems: 'center', gap: 5,
        backgroundColor: accent, borderRadius: 18,
        paddingHorizontal: 14, paddingVertical: 9,
    },
    syncPillText: { fontFamily: 'Inter-SemiBold', fontSize: 13, color: '#fff' },
    liveTag: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10 },
    liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#4caf50' },
    liveText: { fontFamily: 'Inter-SemiBold', fontSize: 11, color: colors.textMuted },
    startBar: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        marginHorizontal: 16, marginTop: 8, marginBottom: 2,
        paddingVertical: 13, borderRadius: 16,
        backgroundColor: isLight ? colors.surface : 'rgba(124,92,252,0.1)',
        borderWidth: 1, borderColor: isLight ? colors.border : 'rgba(124,92,252,0.22)',
    },
    startBarText: { fontFamily: 'Inter-SemiBold', fontSize: 14, color: accent },

    queueCard: {
        flexDirection: 'row', alignItems: 'center', gap: 12,
        backgroundColor: colors.surface,
        borderRadius: 16, padding: 12, marginBottom: 8,
        borderWidth: 1, borderColor: colors.border,
    },
    queueCardPlaying: {
        backgroundColor: isLight ? colors.surfaceActive : 'rgba(124,92,252,0.12)',
        borderColor: isLight ? colors.borderActive : 'rgba(124,92,252,0.3)',
    },
    rank: {
        width: 26, alignItems: 'center',
    },
    rankText: { fontFamily: 'Inter-SemiBold', fontSize: 14, color: colors.textMuted },

    cover: { width: 46, height: 46, borderRadius: 10 },
    coverFallback: { backgroundColor: colors.surfaceHover, alignItems: 'center', justifyContent: 'center' },

    trackInfo: { flex: 1 },
    trackTitle: { fontFamily: 'Inter-SemiBold', fontSize: 14, color: colors.text, marginBottom: 2 },
    trackTitlePlaying: { color: accent },
    trackArtist: { fontFamily: 'Inter-Regular', fontSize: 12, color: colors.textMuted },
    addedBy: { fontFamily: 'Inter-Regular', fontSize: 11, color: colors.textSecondary, marginTop: 2 },

    voteBtn: {
        alignItems: 'center', gap: 3,
        paddingHorizontal: 10, paddingVertical: 6,
        borderRadius: 10, borderWidth: 1,
        borderColor: colors.border,
    },
    voteBtnActive: { backgroundColor: accent, borderColor: accent },
    voteCount: { fontFamily: 'Inter-Bold', fontSize: 12, color: colors.textMuted },
    voteCountActive: { color: '#fff' },

    removeBtn: { paddingLeft: 4 },

    emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 60 },
    emptyText: { fontFamily: 'Inter-SemiBold', fontSize: 15, color: colors.text },
    emptySubText: { fontFamily: 'Inter-Regular', fontSize: 13, color: colors.textMuted, textAlign: 'center' },

    fab: {
        position: 'absolute', left: 24, right: 24,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        backgroundColor: accent, borderRadius: 16, paddingVertical: 15,
        elevation: 8, shadowColor: accent, shadowOpacity: isLight ? 0.18 : 0.4, shadowRadius: 12,
    },
    fabText: { fontFamily: 'Inter-SemiBold', fontSize: 16, color: '#fff' },

    jamDrawer: { height: '92%', backgroundColor: colors.surface },
    modal: { flex: 1, backgroundColor: colors.surface },
    modalHeader: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingBottom: 12,
    },
    modalTitle: { fontFamily: 'Inter-Bold', fontSize: 20, color: colors.text },
    searchRow: {
        flexDirection: 'row', alignItems: 'center', gap: 10,
        marginHorizontal: 16, marginBottom: 4,
        backgroundColor: colors.surfaceHover,
        borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
        borderWidth: 1, borderColor: colors.border,
    },
    searchInput: {
        flex: 1, fontFamily: 'Inter-Regular', fontSize: 15,
        color: colors.text, padding: 0,
    },
    loadingRow: { alignItems: 'center', paddingVertical: 16 },
    searchSkeletonGroup: { paddingHorizontal: 16, paddingTop: 8 },
    searchSkeletonRow: { height: 62, flexDirection: 'row', alignItems: 'center' },
    searchSkeletonCover: { width: 44, height: 44, borderRadius: 8, backgroundColor: colors.surfaceHover },
    searchSkeletonCopy: { flex: 1, marginLeft: 12 },
    searchSkeletonTitle: { width: '58%', height: 10, borderRadius: 5, backgroundColor: colors.textSecondary },
    searchSkeletonMeta: { width: '36%', height: 8, borderRadius: 4, marginTop: 8, backgroundColor: colors.border },
    resultRow: {
        flexDirection: 'row', alignItems: 'center', gap: 12,
        minHeight: 68, paddingHorizontal: 16, paddingVertical: 9,
        borderBottomWidth: 0.5, borderBottomColor: colors.divider,
    },
    resultCover: { width: 44, height: 44, borderRadius: 8 },
    artistResultCover: { borderRadius: 22 },
    resultInfo: { flex: 1 },
    resultTitle: { fontFamily: 'Inter-Medium', fontSize: 14, color: colors.text, marginBottom: 2 },
    resultArtist: { fontFamily: 'Inter-Regular', fontSize: 12, color: colors.textMuted },
    resultRowAdded: { opacity: 0.6 },
    resultFilterList: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 6, paddingBottom: 4, gap: 7 },
    resultFilterChip: {
        flex: 1, minWidth: 0, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
        paddingHorizontal: 7, borderRadius: 21,
        backgroundColor: colors.surfaceHover, borderWidth: 1, borderColor: colors.border,
    },
    resultFilterChipActive: { backgroundColor: accent, borderColor: accent },
    resultFilterText: { fontFamily: 'Inter-SemiBold', fontSize: 11, color: colors.textMuted },
    filterList: {
        flexDirection: 'row', flexWrap: 'wrap',
        paddingHorizontal: 16, paddingTop: 6, paddingBottom: 14,
        columnGap: 8, rowGap: 8,
    },
    filterChip: {
        minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
        paddingHorizontal: 12, paddingVertical: 9, borderRadius: 20,
        backgroundColor: colors.surfaceHover, borderWidth: 1, borderColor: colors.border,
    },
    filterChipActive: { backgroundColor: accent, borderColor: accent },
    filterText: { fontFamily: 'Inter-SemiBold', fontSize: 12, color: colors.textMuted },
    filterTextActive: { color: '#fff' },
    resultsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 2 },
    resultsTitle: { fontFamily: 'Inter-SemiBold', fontSize: 13, color: colors.text },
    resultsCount: { fontFamily: 'Inter-Regular', fontSize: 11, color: colors.textMuted },
    playLikedButton: {
        minHeight: 46, marginHorizontal: 16, marginVertical: 8,
        borderRadius: 16, backgroundColor: accent,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    },
    playLikedText: { fontFamily: 'Inter-SemiBold', fontSize: 14, color: '#fff' },
    searchEmpty: { alignItems: 'center', gap: 8, paddingTop: 52, paddingHorizontal: 24 },
});

// ListenTogetherScreen's grouped layout.
const partyStyles = StyleSheet.create({
    screen: { flex: 1 },
    title: { paddingHorizontal: 20, paddingTop: 8 },
    connection: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingTop: 4 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    groupHeader: { marginLeft: 20, marginRight: 16, marginTop: 26, marginBottom: 8 },
    groupSpacer: { height: 26 },
    group: { marginHorizontal: 16, borderRadius: 14, overflow: 'hidden' },
    groupFooter: { marginHorizontal: 20, marginTop: 8 },
    divider: { height: 0.5, marginLeft: 52 },
    row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 },
    rowCopy: { flex: 1, minWidth: 0, marginLeft: 14, marginRight: 10 },
    code: { fontFamily: 'SFProDisplay-Heavy', fontSize: 36, letterSpacing: 6, textAlign: 'center', paddingVertical: 18 },
    nowRow: { flexDirection: 'row', alignItems: 'center', padding: 12 },
    nowArt: { width: 56, height: 56, borderRadius: 8 },
    hostControls: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    syncPill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
    live: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#4CAF50' },
    avatar: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
    memberLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    badge: { color: '#FA2D48', backgroundColor: 'rgba(250,45,72,0.16)', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
    queueArt: { width: 44, height: 44, borderRadius: 6, marginLeft: -2 },
    vote: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6 },
    remove: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    unread: { minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
});
