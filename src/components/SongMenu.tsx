// HeldContextMenu: the screen blurs behind the held item,
// the item is lifted into view, and a rounded menu of actions sits beneath it
// with the label on the left and the glyph on the right.
import { haptic } from '../services/haptics';
import { useAppSettings } from '../store/appSettings';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Modal, Pressable, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Ionicons from 'react-native-vector-icons/Ionicons';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { API } from '../api';
import type { Album, Track } from '../types';
import { usePlayer } from '../context/PlayerContext';
import { getListeningProfile, toggleLikedTrack } from '../store/listeningProfile';
import { getPrefs } from '../store/preferences';
import { downloadTrackForOffline } from '../services/downloads';
import { GX_TYPE } from '../theme/groovix';

type MenuTarget = { kind: 'track'; track: Track } | { kind: 'album'; album: Album };

const SongMenuContext = createContext<(target: MenuTarget, navigation?: any) => void>(() => {});

/** Long-press handler: opens held menu for a song or an album. */
export function useSongMenu() {
    return useContext(SongMenuContext);
}

type Action = { label: string; icon: React.ReactNode; onPress: () => void | Promise<void> };

const glyph = (name: string) => <Ionicons name={name} size={22} color="#FFFFFF" />;
const mglyph = (name: string) => <MaterialCommunityIcons name={name} size={22} color="#FFFFFF" />;

export function SongMenuProvider({ children }: { children: React.ReactNode }) {
    const [target, setTarget] = useState<MenuTarget | null>(null);
    const settings = useAppSettings();
    const [liked, setLiked] = useState(false);
    const [status, setStatus] = useState<string | null>(null);
    const lift = useRef(new Animated.Value(0)).current;
    // The opening screen's navigator, so Open album/artist stay in its stack.
    const navRef = useRef<any>(null);
    const navigation = { navigate: (name: string, params?: object) => navRef.current?.navigate(name, params) };
    const { playTrack, playPlaylist, addToQueue, playNextInQueue } = usePlayer();
    const { width } = useWindowDimensions();

    const open = useCallback((next: MenuTarget, nav?: any) => {
        haptic('tap');
        navRef.current = nav ?? null;
        setStatus(null);
        setTarget(next);
        if (next.kind === 'track') getListeningProfile().then(profile => setLiked(profile.likedTrackIds.includes(next.track.id)));
    }, []);

    useEffect(() => {
        if (!target) return;
        lift.setValue(0);
        Animated.timing(lift, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, [target, lift]);

    const close = () => setTarget(null);
    const run = (action: () => void | Promise<void>, keepOpen = false) => async () => {
        await action();
        if (!keepOpen) close();
    };

    const albumTracks = async (album: Album) => (await API.getAlbum(album.id)).tracks;

    const actions: Action[] = !target ? [] : target.kind === 'track' ? [
        { label: 'Play', icon: glyph('play'), onPress: run(() => playTrack(target.track)) },
        { label: 'Play next', icon: mglyph('playlist-play'), onPress: run(() => playNextInQueue(target.track)) },
        { label: 'Add to queue', icon: mglyph('playlist-music'), onPress: run(() => addToQueue(target.track)) },
        { label: liked ? 'Remove from liked songs' : 'Add to liked songs', icon: glyph(liked ? 'star' : 'star-outline'), onPress: run(async () => { setLiked(await toggleLikedTrack(target.track)); }) },
        {
            label: 'Download', icon: glyph('download-outline'), onPress: run(async () => {
                setStatus('Downloading…');
                try {
                    const prefs = await getPrefs();
                    await downloadTrackForOffline(target.track, prefs?.downloadQuality ?? 'LOSSLESS', update => setStatus(`Downloading ${Math.round(update.progress * 100)}%`));
                    setStatus('Downloaded');
                } catch (error: any) {
                    setStatus(error?.message || 'Download failed');
                }
            }, true),
        },
        ...(target.track.album?.id ? [{ label: 'Open album', icon: glyph('chevron-forward'), onPress: run(() => navigation.navigate('AlbumDetail', { albumId: target.track.album!.id, albumData: target.track.album })) }] : []),
        ...(target.track.artist?.id ? [{ label: 'Open artist', icon: glyph('person-outline'), onPress: run(() => navigation.navigate('AlbumDetail', { artistId: target.track.artist.id, artistData: target.track.artist })) }] : []),
        { label: 'Share', icon: glyph('share-social-outline'), onPress: run(() => { Share.share({ message: `${target.track.title} — ${target.track.artist?.name ?? ''}` }); }) },
    ] : [
        { label: 'Play', icon: glyph('play'), onPress: run(async () => { const tracks = await albumTracks(target.album); if (tracks.length) playPlaylist(tracks, 0); }) },
        { label: 'Shuffle', icon: glyph('shuffle'), onPress: run(async () => { const tracks = (await albumTracks(target.album)).sort(() => Math.random() - 0.5); if (tracks.length) playPlaylist(tracks, 0); }) },
        { label: 'Play next', icon: mglyph('playlist-play'), onPress: run(async () => { const tracks = await albumTracks(target.album); tracks.slice().reverse().forEach(playNextInQueue); }) },
        { label: 'Add to queue', icon: mglyph('playlist-music'), onPress: run(async () => { (await albumTracks(target.album)).forEach(addToQueue); }) },
        { label: 'Open album', icon: glyph('chevron-forward'), onPress: run(() => navigation.navigate('AlbumDetail', { albumId: target.album.id, albumData: target.album })) },
        { label: 'Share', icon: glyph('share-social-outline'), onPress: run(() => { Share.share({ message: `${target.album.title} — ${target.album.artist?.name ?? ''}` }); }) },
    ];

    const cover = target ? API.getCoverUrl(target.kind === 'track' ? target.track.album?.cover : target.album.cover, 640) : '';
    const title = target ? (target.kind === 'track' ? target.track.title : target.album.title) : '';
    const subtitle = target ? (target.kind === 'track' ? `Song • ${target.track.artist?.name ?? ''}` : `Album • ${target.album.artist?.name ?? ''}`) : '';
    const cardWidth = width * 0.74;

    return (
        <SongMenuContext.Provider value={open}>
            {children}
            <Modal visible={!!target} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
                <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close menu">
                    {cover && !settings.reduceBlur ? <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} blurRadius={40} /> : null}
                    <View style={[StyleSheet.absoluteFill, styles.dim]} />
                </Pressable>
                <ScrollView contentContainerStyle={styles.content} pointerEvents="box-none">
                    <Animated.View style={{ opacity: lift, transform: [{ scale: lift.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }}>
                        <View style={[styles.card, { width: cardWidth, height: cardWidth * 1.08 }]}>
                            <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} />
                            <LinearGradient colors={['transparent', 'rgba(0,0,0,0.7)']} style={styles.cardCaption}>
                                <Text style={[GX_TYPE.titleLarge, styles.white]} numberOfLines={1}>{title}</Text>
                                <Text style={[GX_TYPE.bodyMedium, styles.dimText]} numberOfLines={1}>{subtitle}</Text>
                            </LinearGradient>
                        </View>
                        <View style={[styles.menu, { width: cardWidth }]}>
                            {actions.map(action => (
                                <TouchableOpacity key={action.label} style={styles.row} onPress={action.onPress} activeOpacity={0.6} accessibilityRole="button" accessibilityLabel={action.label}>
                                    <Text style={[GX_TYPE.bodyLarge, styles.rowLabel]} numberOfLines={1}>
                                        {action.label === 'Download' && status ? status : action.label}
                                    </Text>
                                    {action.icon}
                                </TouchableOpacity>
                            ))}
                        </View>
                    </Animated.View>
                </ScrollView>
            </Modal>
        </SongMenuContext.Provider>
    );
}

const styles = StyleSheet.create({
    dim: { backgroundColor: 'rgba(0,0,0,0.62)' },
    content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 60 },
    card: { borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', justifyContent: 'flex-end' },
    cardCaption: { paddingHorizontal: 16, paddingTop: 40, paddingBottom: 14 },
    white: { color: '#FFFFFF' },
    dimText: { color: 'rgba(255,255,255,0.72)' },
    menu: { marginTop: 10, borderRadius: 18, overflow: 'hidden', backgroundColor: 'rgba(20,20,22,0.72)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.10)', paddingVertical: 4 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, height: 54 },
    rowLabel: { color: '#FFFFFF', flex: 1, marginRight: 12 },
});
