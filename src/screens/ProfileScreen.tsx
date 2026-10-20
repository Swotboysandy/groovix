import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
    View, Text, StyleSheet, TouchableOpacity, ScrollView,
    FlatList, Image, TextInput, ActivityIndicator, Modal, NativeModules,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { getPrefs, savePrefs, clearPrefs, GENRE_LIST, UserPrefs, type PlaybackQuality } from '../store/preferences';
import { usePlayer } from '../context/PlayerContext';
import { useResetApp } from '../context/AppContext';
import { APP_VERSION } from '../services/updater';
import { useTheme } from '../context/ThemeContext';
import type { ThemeMode } from '../theme';
import TouchableScale from '../components/TouchableScale';
import SkeletonPulse from '../components/SkeletonPulse';
import { deleteDownloadedTrack, listDownloadedTracks, downloadTrackForOffline, downloadBaseName, DownloadCancelledError, type DownloadedTrackFile } from '../services/downloads';
import { useAppDialog } from '../context/DialogContext';
import { useScreenStatusBar } from '../hooks/useScreenStatusBar';
import { importPlaylistLink } from '../services/playlistImport';
import { deleteImportedPlaylist, getImportedPlaylists, renameImportedPlaylist, saveImportedPlaylist, type ImportedPlaylist } from '../store/importedPlaylists';
import { getUserProfile, saveUserProfile, type UserProfile } from '../store/userProfile';

const ACCENT = '#fa2d48';
type TrackDownloadStatus = { status: 'waiting' | 'downloading' | 'done' | 'failed'; progress: number };
type PlaylistDownloadStatus = {
    playlistId: string;
    status: 'downloading' | 'complete' | 'cancelled';
    total: number;
    completed: number;
    failed: number;
    progress: number;
    currentTitle: string;
};
function formatBytes(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(d: Date): string {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function ProfileScreen({ navigation, route }: any) {
    const { theme, colors, setTheme } = useTheme();
    useScreenStatusBar(theme === 'soundwave' ? 'dark-content' : 'light-content', colors.background);
    const { playTrack, playPlaylist, quality, setQuality } = usePlayer();
    const resetApp = useResetApp();
    const { showDialog } = useAppDialog();
    const [downloads, setDownloads] = useState<DownloadedTrackFile[]>([]);
    const [loadingDownloads, setLoadingDownloads] = useState(true);
    const [prefs, setPrefs] = useState<UserPrefs | null>(null);
    const [activeTab, setActiveTab] = useState<'downloads' | 'playlists' | 'preferences'>('downloads');
    const [playlists, setPlaylists] = useState<ImportedPlaylist[]>([]);
    const [playlistUrl, setPlaylistUrl] = useState('');
    const [importing, setImporting] = useState(false);
    const [importProgress, setImportProgress] = useState('');
    const [importModalVisible, setImportModalVisible] = useState(false);
    const [selectedPlaylist, setSelectedPlaylist] = useState<ImportedPlaylist | null>(null);
    const [renameModalVisible, setRenameModalVisible] = useState(false);
    const [renameTitle, setRenameTitle] = useState('');
    const [userProfile, setUserProfile] = useState<UserProfile>({ displayName: 'My Library' });
    const [profileModalVisible, setProfileModalVisible] = useState(false);
    const [draftProfileName, setDraftProfileName] = useState('My Library');
    const [draftAvatarUri, setDraftAvatarUri] = useState<string | undefined>();
    const [profileSaving, setProfileSaving] = useState(false);
    const [playlistDownload, setPlaylistDownload] = useState<PlaylistDownloadStatus | null>(null);
    const [trackDownloads, setTrackDownloads] = useState<Record<string, TrackDownloadStatus>>({});
    const cancelPlaylistDownload = useRef(false);

    const loadDownloads = useCallback(async () => {
        setLoadingDownloads(true);
        try {
            setDownloads(await listDownloadedTracks());
        } catch (e) {
            console.log('Downloads load error:', e);
        } finally {
            setLoadingDownloads(false);
        }
    }, []);

    useEffect(() => {
        getPrefs().then(p => setPrefs(p));
        getUserProfile().then(setUserProfile);
    }, []);

    useFocusEffect(useCallback(() => {
        loadDownloads();
        getImportedPlaylists().then(setPlaylists);
    }, [loadDownloads]));

    useEffect(() => {
        const sharedUrl = route?.params?.importUrl;
        if (!sharedUrl) return;
        setActiveTab('playlists');
        setSelectedPlaylist(null);
        setPlaylistUrl(sharedUrl);
        setImportModalVisible(true);
        navigation.setParams({ importUrl: undefined });
    }, [navigation, route?.params?.importUrl]);

    // Library links open a specific tab, playlist or the import sheet here.
    useEffect(() => {
        const params = route?.params;
        if (!params?.initialTab && !params?.openPlaylistId && !params?.openImport && !params?.openEditProfile) return;
        if (params.openEditProfile) openProfileEditor();
        if (params.initialTab) setActiveTab(params.initialTab);
        if (params.openPlaylistId) {
            setActiveTab('playlists');
            getImportedPlaylists().then(all => setSelectedPlaylist(all.find(item => item.id === params.openPlaylistId) ?? null));
        }
        if (params.openImport) {
            setActiveTab('playlists');
            setSelectedPlaylist(null);
            setImportModalVisible(true);
        }
        navigation.setParams({ initialTab: undefined, openPlaylistId: undefined, openImport: undefined, openEditProfile: undefined });
    }, [navigation, route?.params]); // eslint-disable-line react-hooks/exhaustive-deps

    const importLink = async () => {
        if (!playlistUrl.trim() || importing) return;
        setImporting(true);
        setImportProgress('Reading playlist…');
        try {
            const playlist = await importPlaylistLink(playlistUrl, (done, total) => setImportProgress(`Matching songs ${done}/${total}`));
            await saveImportedPlaylist(playlist);
            setPlaylists(await getImportedPlaylists());
            setPlaylistUrl('');
            setImportModalVisible(false);
            setSelectedPlaylist(playlist);
        } catch (error: any) {
            showDialog({ title: 'Could not import playlist', message: error?.message || 'Check the link and try again.', icon: 'link-outline' });
        } finally {
            setImporting(false);
            setImportProgress('');
        }
    };

    const playImported = (playlist: ImportedPlaylist, startIndex = 0) => {
        const playableIndex = playlist.tracks.findIndex((item, index) => index >= startIndex && item.resolved);
        const selected = playableIndex >= 0 ? playlist.tracks[playableIndex].resolved : undefined;
        if (!selected) return;
        // One queue update instead of a full-array copy/state update per song.
        const upcoming = playlist.tracks.slice(playableIndex).flatMap(item => item.resolved ? [item.resolved] : []);
        playPlaylist(upcoming);
    };

    const isTrackDownloaded = (track: ImportedPlaylist['tracks'][number]) =>
        Boolean(track.resolved && downloads.some(file => file.name.toLowerCase() === downloadBaseName(track.resolved!).toLowerCase()));

    const downloadPlaylist = async (playlist: ImportedPlaylist) => {
        if (playlistDownload?.status === 'downloading') return;
        const available = playlist.tracks.filter(item => item.resolved);
        const pending = available.filter(item => !isTrackDownloaded(item));
        if (pending.length === 0) {
            setPlaylistDownload({ playlistId: playlist.id, status: 'complete', total: available.length, completed: available.length, failed: 0, progress: 1, currentTitle: 'Available offline' });
            return;
        }
        cancelPlaylistDownload.current = false;
        const initialTrackState: Record<string, TrackDownloadStatus> = {};
        pending.forEach(item => { initialTrackState[String(item.resolved!.id)] = { status: 'waiting', progress: 0 }; });
        setTrackDownloads(initialTrackState);
        setPlaylistDownload({ playlistId: playlist.id, status: 'downloading', total: pending.length, completed: 0, failed: 0, progress: 0, currentTitle: pending[0].title });
        const selectedQuality = prefs?.downloadQuality ?? 'LOSSLESS';
        let completed = 0;
        let failed = 0;
        for (const item of pending) {
            if (cancelPlaylistDownload.current) break;
            const track = item.resolved!;
            const key = String(track.id);
            setTrackDownloads(current => ({ ...current, [key]: { status: 'downloading', progress: 0 } }));
            setPlaylistDownload(current => current ? { ...current, currentTitle: item.title } : current);
            try {
                await downloadTrackForOffline(track, selectedQuality, update => {
                    const overall = (completed + update.progress) / pending.length;
                    setTrackDownloads(current => ({ ...current, [key]: { status: 'downloading', progress: update.progress } }));
                    setPlaylistDownload(current => current ? { ...current, progress: overall, currentTitle: item.title } : current);
                }, () => cancelPlaylistDownload.current);
                completed += 1;
                setTrackDownloads(current => ({ ...current, [key]: { status: 'done', progress: 1 } }));
            } catch (error) {
                if (error instanceof DownloadCancelledError || cancelPlaylistDownload.current) break;
                failed += 1;
                setTrackDownloads(current => ({ ...current, [key]: { status: 'failed', progress: 0 } }));
            }
            setPlaylistDownload(current => current ? { ...current, completed, failed, progress: (completed + failed) / pending.length } : current);
        }
        await loadDownloads();
        const cancelled = cancelPlaylistDownload.current;
        setPlaylistDownload(current => current ? {
            ...current,
            status: cancelled ? 'cancelled' : 'complete',
            completed,
            failed,
            progress: cancelled ? current.progress : 1,
            currentTitle: cancelled ? 'Download paused' : failed ? 'Finished with some unavailable songs' : 'Available offline',
        } : current);
    };

    const stopPlaylistDownload = () => {
        cancelPlaylistDownload.current = true;
    };

    const removeImported = (playlist: ImportedPlaylist) => {
        showDialog({
            title: 'Delete playlist?', message: `Remove "${playlist.title}" from this phone?`, icon: 'trash-outline',
            actions: [
                { text: 'Cancel', tone: 'neutral' },
                { text: 'Delete', tone: 'destructive', onPress: async () => { await deleteImportedPlaylist(playlist.id); setPlaylists(current => current.filter(item => item.id !== playlist.id)); setSelectedPlaylist(current => current?.id === playlist.id ? null : current); } },
            ],
        });
    };

    const openRename = (playlist: ImportedPlaylist) => {
        setRenameTitle(playlist.title);
        setRenameModalVisible(true);
    };

    const saveRename = async () => {
        if (!selectedPlaylist || !renameTitle.trim()) return;
        const renamed = await renameImportedPlaylist(selectedPlaylist.id, renameTitle);
        if (!renamed) return;
        setSelectedPlaylist(renamed);
        setPlaylists(current => current.map(item => item.id === renamed.id ? renamed : item));
        setRenameModalVisible(false);
    };

    const openProfileEditor = () => {
        setDraftProfileName(userProfile.displayName);
        setDraftAvatarUri(userProfile.avatarUri);
        setProfileModalVisible(true);
    };

    const chooseProfilePhoto = async () => {
        try {
            const uri = await NativeModules.ProfilePhotoPicker.pickImage();
            if (uri) setDraftAvatarUri(uri);
        } catch (error: any) {
            showDialog({ title: 'Could not open photo', message: error?.message || 'Please try another image.', icon: 'image-outline' });
        }
    };

    const saveProfileEditor = async () => {
        if (!draftProfileName.trim() || profileSaving) return;
        setProfileSaving(true);
        try {
            let avatarUri = draftAvatarUri;
            if (avatarUri && avatarUri !== userProfile.avatarUri) avatarUri = await NativeModules.ProfilePhotoPicker.saveImage(avatarUri);
            if (!avatarUri && userProfile.avatarUri) await NativeModules.ProfilePhotoPicker.removeSavedImage();
            const saved = await saveUserProfile({ displayName: draftProfileName, avatarUri });
            setUserProfile(saved);
            setProfileModalVisible(false);
        } catch (error: any) {
            showDialog({ title: 'Could not save profile', message: error?.message || 'Please try again.', icon: 'person-outline' });
        } finally {
            setProfileSaving(false);
        }
    };

    const deleteFile = async (file: DownloadedTrackFile) => {
        showDialog({
            title: 'Delete download?',
            message: `Remove "${file.name}"?`,
            icon: 'trash-outline',
            actions: [
                { text: 'Cancel', tone: 'neutral' },
                {
                    text: 'Delete', tone: 'destructive',
                    onPress: async () => {
                    await deleteDownloadedTrack(file);
                    setDownloads(prev => prev.filter(f => f.path !== file.path));
                    },
                },
            ],
        });
    };

    const playFile = async (file: DownloadedTrackFile) => {
        playTrack({
            id: Math.abs(file.path.split('').reduce((a, c) => a + c.charCodeAt(0), 0)),
            title: file.title,
            duration: 0,
            artist: { id: 0, name: file.artist },
            album: { id: 0, title: 'Downloads', cover: file.coverPath ? `file://${file.coverPath}` : '' },
            audioQuality: file.quality || 'LOSSLESS',
            source: 'audiomack',
            localPath: file.path,
        } as any);
    };

    const toggleGenre = async (id: string) => {
        const current = prefs?.genres ?? [];
        const next = current.includes(id) ? current.filter(g => g !== id) : [...current, id];
        const updated = { ...prefs, genres: next, artists: prefs?.artists ?? [] };
        setPrefs(updated as UserPrefs);
        await savePrefs(updated as UserPrefs);
    };

    const setLanguage = async (lang: 'english' | 'hindi' | 'both') => {
        const updated = { genres: prefs?.genres ?? [], artists: prefs?.artists ?? [], language: lang, theme: prefs?.theme };
        setPrefs(updated);
        await savePrefs(updated);
    };

    const setAudioPreference = async (key: 'streamingQuality' | 'downloadQuality', value: PlaybackQuality) => {
        const updated: UserPrefs = {
            genres: prefs?.genres ?? [],
            artists: prefs?.artists ?? [],
            ...prefs,
            [key]: value,
        };
        setPrefs(updated);
        await savePrefs(updated);
        if (key === 'streamingQuality') setQuality(value);
    };

    const handleReset = () => {
        showDialog({
            title: 'Reset profile?',
            message: 'This will clear your genre, artist and language preferences and restart setup.',
            icon: 'refresh-outline',
            actions: [
                { text: 'Cancel', tone: 'neutral' },
                {
                    text: 'Reset', tone: 'destructive',
                    onPress: async () => {
                        await clearPrefs();
                        resetApp();
                    },
                },
            ],
        });
    };

    const totalSize = downloads.reduce((s, f) => s + f.size, 0);

    return (
        <SafeAreaView style={[s.root, { backgroundColor: colors.background }]} edges={['top']}>
            {/* ── HEADER ── */}
            <View style={s.header}>
                <TouchableScale style={[s.avatarCircle, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={openProfileEditor} activeScale={0.94} accessibilityRole="button" accessibilityLabel="Edit profile photo and name">
                    {userProfile.avatarUri ? <Image source={{ uri: userProfile.avatarUri }} style={s.avatarImage} /> : <Icon name="account" size={34} color={colors.textMuted} />}
                    <View style={[s.avatarEditBadge, { backgroundColor: colors.text, borderColor: colors.background }]}><Ionicons name="camera" size={12} color={colors.background} /></View>
                </TouchableScale>
                <View style={{ flex: 1, marginLeft: 14 }}>
                    <TouchableOpacity onPress={openProfileEditor} activeOpacity={0.7}>
                        <Text style={[s.userName, { color: colors.text }]} numberOfLines={1}>{userProfile.displayName}</Text>
                    </TouchableOpacity>
                    <Text style={[s.userSub, { color: colors.textMuted }]}>
                        {downloads.length} downloaded · {formatBytes(totalSize)}
                    </Text>
                </View>
                <TouchableScale
                    style={[s.themeToggle, { backgroundColor: colors.surface, borderColor: colors.border }]}
                    onPress={() => setTheme(theme === 'soundwave' ? 'midnight' : 'soundwave')}
                    activeScale={0.94}
                    accessibilityRole="button"
                    accessibilityLabel={`Switch to ${theme === 'soundwave' ? 'dark' : 'light'} mode`}
                >
                    <Ionicons name={theme === 'soundwave' ? 'moon-outline' : 'sunny-outline'} size={18} color={colors.text} />
                    <Text style={[s.themeToggleText, { color: colors.text }]}>{theme === 'soundwave' ? 'Dark' : 'Light'}</Text>
                </TouchableScale>
            </View>

            {/* ── TABS ── */}
            <View style={[s.tabs, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <TouchableOpacity
                    style={[s.tab, activeTab === 'playlists' && { backgroundColor: colors.surfaceActive }]}
                    onPress={() => setActiveTab('playlists')}
                >
                    <Icon name="playlist-music" size={16} color={activeTab === 'playlists' ? colors.primary : colors.textMuted} style={{ marginRight: 5 }} />
                    <Text style={[s.tabText, { color: activeTab === 'playlists' ? colors.text : colors.textMuted }]}>Playlists</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[s.tab, activeTab === 'downloads' && { backgroundColor: colors.surfaceActive }]}
                    onPress={() => setActiveTab('downloads')}
                >
                    <Icon name="download" size={16} color={activeTab === 'downloads' ? colors.primary : colors.textMuted} style={{ marginRight: 6 }} />
                    <Text style={[s.tabText, { color: activeTab === 'downloads' ? colors.text : colors.textMuted }]}>Downloads</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[s.tab, activeTab === 'preferences' && { backgroundColor: colors.surfaceActive }]}
                    onPress={() => setActiveTab('preferences')}
                >
                    <Icon name="tune-variant" size={16} color={activeTab === 'preferences' ? colors.primary : colors.textMuted} style={{ marginRight: 6 }} />
                    <Text style={[s.tabText, { color: activeTab === 'preferences' ? colors.text : colors.textMuted }]}>Preferences</Text>
                </TouchableOpacity>
            </View>

            {/* ── DOWNLOADS ── */}
            {activeTab === 'downloads' && (
                loadingDownloads ? (
                    <SkeletonPulse style={s.downloadSkeletonGroup}>
                        {[0, 1, 2, 3].map(item => (
                            <View key={item} style={[s.downloadSkeletonRow, { backgroundColor: colors.surface }]}>
                                <View style={[s.downloadSkeletonCover, { backgroundColor: colors.surfaceHover }]} />
                                <View style={s.downloadSkeletonCopy}>
                                    <View style={[s.downloadSkeletonTitle, { backgroundColor: colors.surfaceHover }]} />
                                    <View style={[s.downloadSkeletonMeta, { backgroundColor: colors.surfaceHover }]} />
                                </View>
                            </View>
                        ))}
                    </SkeletonPulse>
                ) : downloads.length === 0 ? (
                    <View style={s.centered}>
                        <Icon name="download-off" size={52} color={colors.textSecondary} />
                        <Text style={[s.emptyText, { color: colors.text }]}>No downloads yet</Text>
                        <Text style={[s.emptySub, { color: colors.textMuted }]}>Open a song, then tap Download for offline listening.</Text>
                        <TouchableScale style={[s.browseButton, { backgroundColor: colors.primary }]} onPress={() => navigation.navigate('ListenNow')} activeScale={0.96} accessibilityRole="button" accessibilityLabel="Browse songs to download">
                            <Ionicons name="musical-notes-outline" size={17} color={colors.background} />
                            <Text style={[s.browseButtonText, { color: colors.background }]}>Browse songs</Text>
                        </TouchableScale>
                    </View>
                ) : (
                    <FlatList
                        data={downloads}
                        keyExtractor={f => f.path}
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={{ paddingBottom: 100 }}
                        renderItem={({ item }) => (
                            <TouchableOpacity style={[s.dlRow, { backgroundColor: colors.surface }]} onPress={() => playFile(item)} activeOpacity={0.75}>
                                {item.coverPath ? <Image source={{ uri: `file://${item.coverPath}` }} style={s.dlCover} /> : (
                                    <View style={s.dlIcon}><Icon name="music-box" size={22} color={ACCENT} /></View>
                                )}
                                <View style={{ flex: 1, marginLeft: 12 }}>
                                    <Text style={[s.dlTitle, { color: colors.text }]} numberOfLines={1}>{item.title}</Text>
                                    <Text style={[s.dlArtist, { color: colors.textMuted }]} numberOfLines={1}>{item.artist}</Text>
                                    <Text style={[s.dlMeta, { color: colors.textMuted }]}>{item.quality ? `${item.quality} · ` : ''}{formatBytes(item.size)} · {formatDate(item.mtime)}</Text>
                                </View>
                                <TouchableOpacity onPress={() => deleteFile(item)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityRole="button" accessibilityLabel={`Delete ${item.title}`}>
                                    <Icon name="trash-can-outline" size={20} color={colors.textMuted} />
                                </TouchableOpacity>
                            </TouchableOpacity>
                        )}
                    />
                )
            )}

            {activeTab === 'playlists' && (
                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={s.playlistContent}>
                    {selectedPlaylist ? (
                        <View>
                            <TouchableOpacity style={s.playlistBack} onPress={() => setSelectedPlaylist(null)}>
                                <Ionicons name="chevron-back" size={21} color={colors.text} />
                                <Text style={[s.playlistBackText, { color: colors.text }]}>Playlists</Text>
                            </TouchableOpacity>
                            <View style={s.playlistHero}>
                                {selectedPlaylist.cover ? <Image source={{ uri: selectedPlaylist.cover }} style={s.playlistHeroCover} /> : <View style={[s.playlistHeroCover, s.playlistCoverFallback]}><Icon name="playlist-music" size={58} color="#fff" /></View>}
                                <View style={s.playlistTitleRow}>
                                    <Text style={[s.playlistHeroTitle, { color: colors.text }]}>{selectedPlaylist.title}</Text>
                                    <TouchableOpacity style={[s.renameButton, { borderColor: colors.border }]} onPress={() => openRename(selectedPlaylist)} accessibilityRole="button" accessibilityLabel="Rename playlist">
                                        <Ionicons name="pencil-outline" size={17} color={colors.textMuted} />
                                    </TouchableOpacity>
                                </View>
                                <Text style={[s.playlistHeroMeta, { color: colors.textMuted }]}>{selectedPlaylist.tracks.length} songs · {selectedPlaylist.tracks.filter(track => track.resolved).length} available · {selectedPlaylist.platform}</Text>
                                <View style={s.heroActions}>
                                    <TouchableScale style={[s.heroPlayButton, { backgroundColor: colors.text }]} onPress={() => playImported(selectedPlaylist)} activeScale={0.92} accessibilityRole="button" accessibilityLabel={`Play ${selectedPlaylist.title}`}>
                                        <Ionicons name="play" size={24} color={colors.background} />
                                    </TouchableScale>
                                    <TouchableScale style={[s.downloadAllButton, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={() => downloadPlaylist(selectedPlaylist)} disabled={playlistDownload?.status === 'downloading'} activeScale={0.95} accessibilityRole="button" accessibilityLabel={`Download all songs from ${selectedPlaylist.title}`}>
                                        <Ionicons name={selectedPlaylist.tracks.filter(isTrackDownloaded).length === selectedPlaylist.tracks.filter(item => item.resolved).length ? 'checkmark-circle' : 'download-outline'} size={19} color={colors.text} />
                                        <Text style={[s.downloadAllText, { color: colors.text }]}>{selectedPlaylist.tracks.filter(isTrackDownloaded).length === selectedPlaylist.tracks.filter(item => item.resolved).length ? 'Downloaded' : 'Download all'}</Text>
                                    </TouchableScale>
                                </View>
                            </View>
                            {playlistDownload?.playlistId === selectedPlaylist.id && (
                                <View style={[s.playlistDownloadCard, { backgroundColor: colors.surface, borderColor: colors.border }]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(playlistDownload.progress * 100) }}>
                                    <View style={s.downloadStatusHeader}>
                                        <View style={{ flex: 1 }}>
                                            <Text style={[s.downloadStatusTitle, { color: colors.text }]}>{playlistDownload.status === 'downloading' ? `Downloading ${Math.round(playlistDownload.progress * 100)}%` : playlistDownload.status === 'cancelled' ? 'Download paused' : playlistDownload.failed ? 'Download finished' : 'Playlist downloaded'}</Text>
                                            <Text style={[s.downloadStatusSub, { color: colors.textMuted }]} numberOfLines={1}>{playlistDownload.currentTitle}</Text>
                                        </View>
                                        {playlistDownload.status === 'downloading' ? (
                                            <TouchableOpacity style={s.cancelDownloadButton} onPress={stopPlaylistDownload} accessibilityRole="button" accessibilityLabel="Cancel playlist download"><Ionicons name="close" size={19} color={colors.text} /></TouchableOpacity>
                                        ) : (
                                            <TouchableOpacity style={s.cancelDownloadButton} onPress={() => setPlaylistDownload(null)} accessibilityRole="button" accessibilityLabel="Dismiss download status"><Ionicons name="close" size={19} color={colors.textMuted} /></TouchableOpacity>
                                        )}
                                    </View>
                                    <View style={[s.playlistProgressTrack, { backgroundColor: colors.border }]}><View style={[s.playlistProgressFill, { backgroundColor: colors.primary, width: `${Math.round(playlistDownload.progress * 100)}%` }]} /></View>
                                    <Text style={[s.downloadCount, { color: colors.textMuted }]}>{playlistDownload.completed} completed{playlistDownload.failed ? ` · ${playlistDownload.failed} failed` : ''} · {playlistDownload.total} total</Text>
                                </View>
                            )}
                            <View style={s.playlistTracks}>
                                {selectedPlaylist.tracks.map((track, index) => (
                                    <TouchableOpacity key={`${selectedPlaylist.id}-${track.resolved?.id || `${track.title}-${track.artist}`}-${index}`} style={s.importedTrack} onPress={() => track.resolved && playImported(selectedPlaylist, index)} disabled={!track.resolved} activeOpacity={0.7}>
                                        <Text style={[s.trackNumber, { color: colors.textMuted }]}>{String(index + 1).padStart(2, '0')}</Text>
                                        <View style={{ flex: 1 }}>
                                            <Text style={[s.importedTrackTitle, { color: track.resolved ? colors.text : colors.textMuted }]} numberOfLines={1}>{track.title}</Text>
                                            <Text style={[s.importedTrackArtist, { color: colors.textMuted }]} numberOfLines={1}>{track.artist}{track.resolved ? '' : ' · Unavailable'}</Text>
                                        </View>
                                        {track.resolved && trackDownloads[String(track.resolved.id)]?.status === 'downloading' ? <Text style={[s.trackDownloadPercent, { color: colors.text }]}>{Math.round(trackDownloads[String(track.resolved.id)].progress * 100)}%</Text>
                                            : track.resolved && (isTrackDownloaded(track) || trackDownloads[String(track.resolved.id)]?.status === 'done') ? <Ionicons name="checkmark-circle" size={18} color="#4CAF50" />
                                                : track.resolved && trackDownloads[String(track.resolved.id)]?.status === 'failed' ? <Ionicons name="alert-circle-outline" size={18} color="#ff5a67" />
                                                    : <Ionicons name={track.resolved ? 'play-outline' : 'remove-outline'} size={18} color={colors.textMuted} />}
                                    </TouchableOpacity>
                                ))}
                            </View>
                            <TouchableOpacity style={s.deletePlaylist} onPress={() => removeImported(selectedPlaylist)}>
                                <Ionicons name="trash-outline" size={16} color="#ff5a67" />
                                <Text style={s.deletePlaylistText}>Delete from this phone</Text>
                            </TouchableOpacity>
                        </View>
                    ) : <>
                        <View style={s.playlistSectionHeader}>
                            <View>
                                <Text style={[s.playlistSectionTitle, { color: colors.text }]}>Your playlists</Text>
                                <Text style={[s.playlistSectionSubtitle, { color: colors.textMuted }]}>Saved on this phone</Text>
                            </View>
                            <TouchableScale style={[s.openImportButton, { backgroundColor: colors.text }]} onPress={() => setImportModalVisible(true)} activeScale={0.94}>
                                <Ionicons name="add" size={19} color={colors.background} />
                                <Text style={[s.openImportText, { color: colors.background }]}>Import</Text>
                            </TouchableScale>
                        </View>
                        {playlists.length === 0 ? (
                        <View style={s.playlistEmpty}>
                            <Icon name="playlist-music-outline" size={48} color={colors.textMuted} />
                            <Text style={[s.emptyText, { color: colors.text }]}>No imported playlists</Text>
                            <Text style={[s.emptySub, { color: colors.textMuted, textAlign: 'center' }]}>Import a public playlist link to keep it here.</Text>
                        </View>
                        ) : <View style={s.playlistGrid}>{playlists.map(playlist => (
                            <TouchableOpacity key={playlist.id} style={s.playlistTile} activeOpacity={0.78} onPress={() => setSelectedPlaylist(playlist)}>
                                {playlist.cover ? <Image source={{ uri: playlist.cover }} style={s.playlistTileCover} /> : <View style={[s.playlistTileCover, s.playlistCoverFallback]}><Icon name="playlist-music" size={38} color="#fff" /></View>}
                                <Text style={[s.playlistTileTitle, { color: colors.text }]} numberOfLines={1}>{playlist.title}</Text>
                                <Text style={[s.playlistTileMeta, { color: colors.textMuted }]} numberOfLines={1}>{playlist.tracks.length} songs · {playlist.platform}</Text>
                            </TouchableOpacity>
                        ))}</View>}
                    </>}
                </ScrollView>
            )}

            {/* ── PREFERENCES ── */}
            {activeTab === 'preferences' && (
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
                    <Text style={[s.sectionLabel, { color: colors.textMuted }]}>Language</Text>
                    <View style={s.langRow}>
                        {(['english', 'hindi', 'both'] as const).map(lang => {
                            const active = (prefs?.language ?? 'both') === lang;
                            return (
                                <TouchableOpacity
                                    key={lang}
                                    style={[s.langChip, { backgroundColor: colors.surface, borderColor: colors.border }, active && { backgroundColor: colors.surfaceActive, borderColor: colors.primary }]}
                                    onPress={() => setLanguage(lang)}
                                    activeOpacity={0.75}
                                >
                                    <Text style={[s.langChipText, { color: colors.textMuted }, active && { color: colors.text }] }>
                                        {lang === 'english' ? '🇬🇧 English' : lang === 'hindi' ? '🇮🇳 Hindi' : '🌐 Both'}
                                    </Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>

                    <Text style={[s.sectionLabel, { marginTop: 24, color: colors.textMuted }]}>Your Genres</Text>
                    <View style={s.genreGrid}>
                        {GENRE_LIST.map(g => {
                            const sel = prefs?.genres?.includes(g.id);
                            return (
                                <TouchableOpacity
                                    key={g.id}
                                    style={s.genreCircleWrap}
                                    onPress={() => toggleGenre(g.id)}
                                    activeOpacity={0.75}
                                >
                                    <View style={[
                                        s.genreCircle,
                                        { backgroundColor: g.color + '22' },
                                        sel && { backgroundColor: g.color + '33', borderColor: g.color, borderWidth: 2 },
                                    ]}>
                                        <Icon name={g.icon} size={26} color={sel ? g.color : g.color + '99'} />
                                    </View>
                                    <Text style={[s.genreCircleLabel, { color: colors.textMuted }, sel && { color: colors.text }]}>{g.label}</Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>

                    <Text style={[s.sectionLabel, { marginTop: 24, color: colors.textMuted }]}>Audio quality</Text>
                    <View style={[s.preferenceCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                        <Text style={[s.preferenceTitle, { color: colors.text }]}>Streaming</Text>
                        <Text style={[s.preferenceDescription, { color: colors.textMuted }]}>Default for new songs. Groovix falls back only when that master is unavailable.</Text>
                        <View style={s.qualityOptions}>
                            {([
                                ['HI_RES_LOSSLESS', 'Hi-Res'],
                                ['LOSSLESS', 'FLAC'],
                                ['HIGH', 'AAC 320'],
                                ['LOW', 'AAC 96'],
                            ] as const).map(([value, label]) => {
                                const selected = (prefs?.streamingQuality ?? quality) === value;
                                return (
                                    <TouchableOpacity key={`stream-${value}`} style={[s.qualityOption, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.surfaceActive : colors.background }]} onPress={() => setAudioPreference('streamingQuality', value)} accessibilityRole="radio" accessibilityState={{ checked: selected }}>
                                        <Text style={[s.qualityOptionText, { color: selected ? colors.text : colors.textMuted }]}>{label}</Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>

                        <View style={[s.preferenceDivider, { backgroundColor: colors.border }]} />
                        <Text style={[s.preferenceTitle, { color: colors.text }]}>Downloads</Text>
                        <Text style={[s.preferenceDescription, { color: colors.textMuted }]}>Saved songs use this quality independently of streaming.</Text>
                        <View style={s.qualityOptions}>
                            {([
                                ['HI_RES_LOSSLESS', 'Hi-Res'],
                                ['LOSSLESS', 'FLAC'],
                                ['HIGH', 'AAC 320'],
                                ['LOW', 'AAC 96'],
                            ] as const).map(([value, label]) => {
                                const selected = (prefs?.downloadQuality ?? 'LOSSLESS') === value;
                                return (
                                    <TouchableOpacity key={`download-${value}`} style={[s.qualityOption, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.surfaceActive : colors.background }]} onPress={() => setAudioPreference('downloadQuality', value)} accessibilityRole="radio" accessibilityState={{ checked: selected }}>
                                        <Text style={[s.qualityOptionText, { color: selected ? colors.text : colors.textMuted }]}>{label}</Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                    </View>

                    <Text style={[s.sectionLabel, { marginTop: 24, color: colors.textMuted }]}>Color palette</Text>
                    <View style={s.paletteRow}>
                        {([
                            { id: 'midnight' as ThemeMode, label: 'Midnight', swatches: ['#000000', '#121212', '#FA2D48'] },
                            { id: 'soundwave' as ThemeMode, label: 'Soundwave', swatches: ['#171C26', '#6C7689', '#FFFFFF'] },
                        ]).map(option => (
                            <TouchableOpacity key={option.id} style={[s.paletteCard, { backgroundColor: colors.surface, borderColor: theme === option.id ? colors.primary : colors.border }]} onPress={() => setTheme(option.id)} accessibilityRole="button" accessibilityState={{ selected: theme === option.id }}>
                                <View style={s.swatchRow}>{option.swatches.map(color => <View key={color} style={[s.swatch, { backgroundColor: color }]} />)}</View>
                                <Text style={[s.paletteLabel, { color: colors.text }]}>{option.label}</Text>
                                {theme === option.id && <Icon name="check-circle" size={16} color={colors.primary} />}
                            </TouchableOpacity>
                        ))}
                    </View>

                    <Text style={[s.sectionLabel, { marginTop: 24, color: colors.textMuted }]}>About</Text>
                    <View style={[s.aboutCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                        <Icon name="music-circle" size={32} color={ACCENT} />
                        <View style={{ marginLeft: 14, flex: 1 }}>
                            <Text style={[s.aboutTitle, { color: colors.text }]}>Groovix</Text>
                            <Text style={[s.aboutSub, { color: colors.textMuted }]}>Your personal music player</Text>
                        </View>
                        <Text style={[s.aboutVersion, { color: colors.textMuted }]}>v{APP_VERSION}</Text>
                    </View>

                    <TouchableOpacity style={s.resetBtn} onPress={handleReset} activeOpacity={0.8}>
                        <Icon name="refresh" size={18} color="#ff4d4d" style={{ marginRight: 8 }} />
                        <Text style={s.resetBtnText}>Reset Profile & Preferences</Text>
                    </TouchableOpacity>
                </ScrollView>
            )}
            <Modal visible={profileModalVisible} transparent animationType="fade" onRequestClose={() => !profileSaving && setProfileModalVisible(false)} statusBarTranslucent>
                <View style={s.modalBackdrop}>
                    <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => !profileSaving && setProfileModalVisible(false)} />
                    <View style={[s.importModal, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                        <View style={s.modalHeader}>
                            <View style={{ flex: 1 }}>
                                <Text style={[s.modalTitle, { color: colors.text }]}>Edit profile</Text>
                                <Text style={[s.modalSubtitle, { color: colors.textMuted }]}>Choose your name and profile photo.</Text>
                            </View>
                            <TouchableOpacity onPress={() => setProfileModalVisible(false)} disabled={profileSaving} hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}>
                                <Ionicons name="close" size={24} color={colors.textMuted} />
                            </TouchableOpacity>
                        </View>
                        <View style={s.profilePhotoSection}>
                            <TouchableScale style={[s.profilePhotoPreview, { backgroundColor: colors.background, borderColor: colors.border }]} onPress={chooseProfilePhoto} activeScale={0.96} accessibilityRole="button" accessibilityLabel="Choose profile photo from gallery">
                                {draftAvatarUri ? <Image source={{ uri: draftAvatarUri }} style={s.profilePhotoImage} /> : <Icon name="account" size={54} color={colors.textMuted} />}
                                <View style={[s.profilePhotoCamera, { backgroundColor: colors.text }]}><Ionicons name="camera" size={17} color={colors.background} /></View>
                            </TouchableScale>
                            <TouchableOpacity onPress={chooseProfilePhoto} style={s.photoAction}>
                                <Text style={[s.photoActionText, { color: colors.text }]}>Choose from gallery</Text>
                            </TouchableOpacity>
                            {draftAvatarUri ? <TouchableOpacity onPress={() => setDraftAvatarUri(undefined)} style={s.photoAction}><Text style={s.removePhotoText}>Remove photo</Text></TouchableOpacity> : null}
                        </View>
                        <Text style={[s.profileFieldLabel, { color: colors.textMuted }]}>Profile name</Text>
                        <View style={[s.modalInput, s.profileNameInput, { backgroundColor: colors.background, borderColor: colors.border }]}>
                            <Ionicons name="person-outline" size={19} color={colors.textMuted} />
                            <TextInput value={draftProfileName} onChangeText={setDraftProfileName} placeholder="Your name" placeholderTextColor={colors.textMuted} autoCapitalize="words" autoCorrect maxLength={40} selectTextOnFocus style={[s.linkInput, { color: colors.text }]} onSubmitEditing={saveProfileEditor} />
                        </View>
                        <TouchableScale style={[s.modalImportButton, { backgroundColor: colors.text }, (!draftProfileName.trim() || profileSaving) && { opacity: 0.45 }]} onPress={saveProfileEditor} disabled={!draftProfileName.trim() || profileSaving} activeScale={0.97}>
                            {profileSaving ? <ActivityIndicator size="small" color={colors.background} /> : <Text style={[s.modalImportText, { color: colors.background }]}>Save profile</Text>}
                        </TouchableScale>
                    </View>
                </View>
            </Modal>
            <Modal visible={importModalVisible} transparent animationType="fade" onRequestClose={() => !importing && setImportModalVisible(false)} statusBarTranslucent>
                <View style={s.modalBackdrop}>
                    <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => !importing && setImportModalVisible(false)} />
                    <View style={[s.importModal, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                        <View style={s.modalHeader}>
                            <View style={{ flex: 1 }}>
                                <Text style={[s.modalTitle, { color: colors.text }]}>Import playlist</Text>
                                <Text style={[s.modalSubtitle, { color: colors.textMuted }]}>Paste a public Spotify, YouTube, Apple Music or TIDAL link.</Text>
                            </View>
                            <TouchableOpacity onPress={() => setImportModalVisible(false)} disabled={importing} hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}>
                                <Ionicons name="close" size={24} color={colors.textMuted} />
                            </TouchableOpacity>
                        </View>
                        <View style={[s.modalInput, { backgroundColor: colors.background, borderColor: colors.border }]}>
                            <Ionicons name="link-outline" size={19} color={colors.textMuted} />
                            <TextInput value={playlistUrl} onChangeText={setPlaylistUrl} placeholder="Paste playlist link" placeholderTextColor={colors.textMuted} autoCapitalize="none" autoCorrect={false} keyboardType="url" editable={!importing} style={[s.linkInput, { color: colors.text }]} onSubmitEditing={importLink} />
                        </View>
                        {importing && <View style={s.importStatus}><ActivityIndicator size="small" color={colors.primary} /><Text style={[s.progressText, { color: colors.textMuted }]}>{importProgress}</Text></View>}
                        <TouchableScale style={[s.modalImportButton, { backgroundColor: colors.text }, (!playlistUrl.trim() || importing) && { opacity: 0.45 }]} onPress={importLink} disabled={!playlistUrl.trim() || importing} activeScale={0.97}>
                            <Text style={[s.modalImportText, { color: colors.background }]}>{importing ? 'Importing…' : 'Import playlist'}</Text>
                        </TouchableScale>
                    </View>
                </View>
            </Modal>
            <Modal visible={renameModalVisible} transparent animationType="fade" onRequestClose={() => setRenameModalVisible(false)} statusBarTranslucent>
                <View style={s.modalBackdrop}>
                    <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setRenameModalVisible(false)} />
                    <View style={[s.importModal, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                        <View style={s.modalHeader}>
                            <View style={{ flex: 1 }}>
                                <Text style={[s.modalTitle, { color: colors.text }]}>Rename playlist</Text>
                                <Text style={[s.modalSubtitle, { color: colors.textMuted }]}>Choose how this playlist appears in your library.</Text>
                            </View>
                            <TouchableOpacity onPress={() => setRenameModalVisible(false)} hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}>
                                <Ionicons name="close" size={24} color={colors.textMuted} />
                            </TouchableOpacity>
                        </View>
                        <View style={[s.modalInput, { backgroundColor: colors.background, borderColor: colors.border }]}>
                            <Ionicons name="pencil-outline" size={19} color={colors.textMuted} />
                            <TextInput value={renameTitle} onChangeText={setRenameTitle} placeholder="Playlist name" placeholderTextColor={colors.textMuted} autoCapitalize="sentences" autoCorrect maxLength={80} selectTextOnFocus style={[s.linkInput, { color: colors.text }]} onSubmitEditing={saveRename} />
                        </View>
                        <TouchableScale style={[s.modalImportButton, { backgroundColor: colors.text }, !renameTitle.trim() && { opacity: 0.45 }]} onPress={saveRename} disabled={!renameTitle.trim()} activeScale={0.97}>
                            <Text style={[s.modalImportText, { color: colors.background }]}>Save name</Text>
                        </TouchableScale>
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#0a0a0a' },

    header: {
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16,
    },
    avatarCircle: {
        width: 56, height: 56, borderRadius: 28,
        backgroundColor: 'rgba(255,255,255,0.08)',
        alignItems: 'center', justifyContent: 'center',
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    },
    avatarImage: { width: '100%', height: '100%', borderRadius: 28 },
    avatarEditBadge: { position: 'absolute', right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
    userName: { fontFamily: 'Inter-Bold', color: '#fff', fontSize: 20 },
    userSub: { fontFamily: 'Inter-Regular', color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 2 },
    themeToggle: { minWidth: 72, minHeight: 40, borderRadius: 20, borderWidth: 1, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
    themeToggleText: { fontFamily: 'Inter-SemiBold', fontSize: 12 },

    tabs: {
        flexDirection: 'row', marginHorizontal: 20, marginBottom: 16,
        backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1,
        borderRadius: 12, padding: 4,
    },
    tab: {
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        paddingVertical: 9, borderRadius: 9,
    },
    tabActive: { backgroundColor: 'rgba(255,255,255,0.1)' },
    tabText: { fontFamily: 'Inter-SemiBold', color: 'rgba(255,255,255,0.45)', fontSize: 13.5 },
    tabTextActive: { fontFamily: 'Inter-SemiBold', color: '#fff' },
    playlistContent: { paddingBottom: 110 },
    linkInput: { flex: 1, fontFamily: 'Inter-Regular', fontSize: 13, paddingVertical: 0 },
    progressText: { fontFamily: 'Inter-Medium', fontSize: 12 },
    playlistSectionHeader: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    playlistSectionTitle: { fontFamily: 'Inter-Bold', fontSize: 22, letterSpacing: -0.4 },
    playlistSectionSubtitle: { fontFamily: 'Inter-Regular', fontSize: 12, marginTop: 3 },
    openImportButton: { minHeight: 42, paddingHorizontal: 15, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 5 },
    openImportText: { fontFamily: 'Inter-SemiBold', fontSize: 13 },
    playlistEmpty: { paddingHorizontal: 42, paddingVertical: 48, alignItems: 'center', gap: 7 },
    playlistGrid: { paddingHorizontal: 20, flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 22 },
    playlistTile: { width: '47.8%' },
    playlistTileCover: { width: '100%', aspectRatio: 1, borderRadius: 14 },
    playlistTileTitle: { fontFamily: 'Inter-SemiBold', fontSize: 14, marginTop: 9 },
    playlistTileMeta: { fontFamily: 'Inter-Regular', fontSize: 11.5, marginTop: 3, textTransform: 'capitalize' },
    playlistCoverFallback: { backgroundColor: '#273043', alignItems: 'center', justifyContent: 'center' },
    playlistBack: { marginHorizontal: 14, minHeight: 42, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center' },
    playlistBackText: { fontFamily: 'Inter-SemiBold', fontSize: 14 },
    playlistHero: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 8, paddingBottom: 18 },
    playlistHeroCover: { width: 176, height: 176, borderRadius: 18 },
    playlistTitleRow: { marginTop: 17, paddingLeft: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
    playlistHeroTitle: { flexShrink: 1, fontFamily: 'Inter-Bold', fontSize: 23, letterSpacing: -0.5, textAlign: 'center' },
    renameButton: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    playlistHeroMeta: { fontFamily: 'Inter-Regular', fontSize: 12, textTransform: 'capitalize', textAlign: 'center', marginTop: 5 },
    heroActions: { marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
    heroPlayButton: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', paddingLeft: 2 },
    downloadAllButton: { height: 50, paddingHorizontal: 16, borderRadius: 15, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
    downloadAllText: { fontFamily: 'Inter-SemiBold', fontSize: 13 },
    playlistDownloadCard: { marginHorizontal: 20, marginBottom: 13, padding: 14, borderRadius: 14, borderWidth: 1 },
    downloadStatusHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    downloadStatusTitle: { fontFamily: 'Inter-SemiBold', fontSize: 14 },
    downloadStatusSub: { fontFamily: 'Inter-Regular', fontSize: 11.5, marginTop: 3 },
    cancelDownloadButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    playlistProgressTrack: { height: 6, borderRadius: 3, marginTop: 13, overflow: 'hidden' },
    playlistProgressFill: { height: '100%', borderRadius: 3 },
    downloadCount: { fontFamily: 'Inter-Medium', fontSize: 11, marginTop: 8 },
    playlistTracks: { paddingHorizontal: 20, paddingBottom: 8 },
    importedTrack: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 11 },
    trackNumber: { width: 22, fontFamily: 'Inter-Medium', fontSize: 11 },
    importedTrackTitle: { fontFamily: 'Inter-SemiBold', fontSize: 13 },
    importedTrackArtist: { fontFamily: 'Inter-Regular', fontSize: 11, marginTop: 2 },
    trackDownloadPercent: { width: 38, textAlign: 'right', fontFamily: 'Inter-SemiBold', fontSize: 11.5 },
    deletePlaylist: { minHeight: 43, marginTop: 3, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
    deletePlaylistText: { color: '#ff5a67', fontFamily: 'Inter-SemiBold', fontSize: 12 },
    modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.58)' },
    importModal: { borderWidth: 1, borderBottomWidth: 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 30 },
    modalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
    modalTitle: { fontFamily: 'Inter-Bold', fontSize: 21, letterSpacing: -0.35 },
    modalSubtitle: { fontFamily: 'Inter-Regular', fontSize: 12.5, lineHeight: 18, marginTop: 5 },
    modalInput: { height: 52, borderWidth: 1, borderRadius: 13, marginTop: 20, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
    importStatus: { minHeight: 42, paddingTop: 13, flexDirection: 'row', alignItems: 'center', gap: 9 },
    modalImportButton: { minHeight: 50, borderRadius: 13, marginTop: 16, alignItems: 'center', justifyContent: 'center' },
    modalImportText: { fontFamily: 'Inter-SemiBold', fontSize: 14 },
    profilePhotoSection: { alignItems: 'center', paddingTop: 22, paddingBottom: 7 },
    profilePhotoPreview: { width: 104, height: 104, borderRadius: 52, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    profilePhotoImage: { width: '100%', height: '100%', borderRadius: 52 },
    profilePhotoCamera: { position: 'absolute', right: 1, bottom: 1, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    photoAction: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 10 },
    photoActionText: { fontFamily: 'Inter-SemiBold', fontSize: 13, marginTop: 5 },
    removePhotoText: { color: '#ff5a67', fontFamily: 'Inter-Medium', fontSize: 12 },
    profileFieldLabel: { fontFamily: 'Inter-SemiBold', fontSize: 11.5, marginTop: 7, textTransform: 'uppercase', letterSpacing: 0.6 },
    profileNameInput: { marginTop: 8 },

    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
    emptyText: { fontFamily: 'Inter-SemiBold', color: 'rgba(255,255,255,0.5)', fontSize: 16, marginTop: 8 },
    emptySub: { fontFamily: 'Inter-Regular', color: 'rgba(255,255,255,0.25)', fontSize: 13 },
    browseButton: { minHeight: 44, marginTop: 10, paddingHorizontal: 18, borderRadius: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
    browseButtonText: { fontFamily: 'Inter-SemiBold', fontSize: 13 },

    dlRow: {
        flexDirection: 'row', alignItems: 'center',
        marginHorizontal: 20, marginBottom: 2,
        paddingVertical: 12, paddingHorizontal: 14,
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderRadius: 14,
        marginTop: 6,
    },
    dlIcon: {
        width: 44, height: 44, borderRadius: 10,
        backgroundColor: 'rgba(250,45,72,0.12)',
        alignItems: 'center', justifyContent: 'center',
    },
    dlCover: { width: 44, height: 44, borderRadius: 10 },
    dlTitle: { fontFamily: 'Inter-SemiBold', color: '#fff', fontSize: 14 },
    dlArtist: { fontFamily: 'Inter-Regular', fontSize: 11, marginTop: 1 },
    dlMeta: { fontFamily: 'Inter-Regular', color: 'rgba(255,255,255,0.35)', fontSize: 12, marginTop: 2 },
    downloadSkeletonGroup: { paddingHorizontal: 20 },
    downloadSkeletonRow: { height: 72, borderRadius: 14, marginTop: 6, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center' },
    downloadSkeletonCover: { width: 44, height: 44, borderRadius: 10 },
    downloadSkeletonCopy: { flex: 1, marginLeft: 12 },
    downloadSkeletonTitle: { width: '58%', height: 11, borderRadius: 6 },
    downloadSkeletonMeta: { width: '36%', height: 8, borderRadius: 4, marginTop: 9 },

    sectionLabel: {
        fontFamily: 'Inter-Bold', color: 'rgba(255,255,255,0.4)', fontSize: 12,
        letterSpacing: 0.8, textTransform: 'uppercase',
        marginHorizontal: 20, marginBottom: 12,
    },
    genreGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 20, gap: 16 },
    genreCircleWrap: { alignItems: 'center', width: 64 },
    genreCircle: {
        width: 60, height: 60, borderRadius: 30,
        alignItems: 'center', justifyContent: 'center',
        borderWidth: 1.5, borderColor: 'transparent',
    },
    genreCircleLabel: { fontFamily: 'Inter-SemiBold', color: 'rgba(255,255,255,0.45)', fontSize: 11, marginTop: 6, textAlign: 'center' },

    langRow: { flexDirection: 'row', paddingHorizontal: 20, gap: 10, marginBottom: 8 },
    langChip: {
        flex: 1, alignItems: 'center', paddingVertical: 10,
        borderRadius: 12, borderWidth: 1,
        backgroundColor: 'rgba(255,255,255,0.05)',
        borderColor: 'rgba(255,255,255,0.1)',
    },
    langChipActive: { backgroundColor: 'rgba(250,45,72,0.15)', borderColor: ACCENT },
    langChipText: { fontFamily: 'Inter-SemiBold', color: 'rgba(255,255,255,0.45)', fontSize: 13.5 },
    langChipTextActive: { fontFamily: 'Inter-SemiBold', color: '#fff' },

    paletteRow: { flexDirection: 'row', paddingHorizontal: 20, gap: 10 },
    paletteCard: {
        flex: 1, minHeight: 78, borderRadius: 16, borderWidth: 1,
        padding: 12, justifyContent: 'space-between',
    },
    swatchRow: { flexDirection: 'row', gap: 5 },
    swatch: { width: 22, height: 22, borderRadius: 7, borderWidth: 1, borderColor: 'rgba(128,128,128,0.18)' },
    paletteLabel: { fontFamily: 'Inter-SemiBold', fontSize: 13 },
    preferenceCard: { marginHorizontal: 20, borderRadius: 16, borderWidth: 1, padding: 14 },
    preferenceTitle: { fontFamily: 'Inter-SemiBold', fontSize: 14 },
    preferenceDescription: { fontFamily: 'Inter-Regular', fontSize: 12, lineHeight: 17, marginTop: 3 },
    preferenceDivider: { height: StyleSheet.hairlineWidth, marginVertical: 16 },
    qualityOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
    qualityOption: { minHeight: 40, minWidth: '47%', flexGrow: 1, borderRadius: 12, borderWidth: 1, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
    qualityOptionText: { fontFamily: 'Inter-SemiBold', fontSize: 12 },

    resetBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        marginHorizontal: 20, marginTop: 20, marginBottom: 40,
        paddingVertical: 14, borderRadius: 14,
        backgroundColor: 'rgba(255,77,77,0.1)',
        borderWidth: 1, borderColor: 'rgba(255,77,77,0.25)',
    },
    resetBtnText: { fontFamily: 'Inter-SemiBold', color: '#ff4d4d', fontSize: 14 },

    aboutCard: {
        flexDirection: 'row', alignItems: 'center',
        marginHorizontal: 20, padding: 16,
        backgroundColor: 'rgba(255,255,255,0.05)',
        borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    },
    aboutTitle: { fontFamily: 'Inter-Bold', color: '#fff', fontSize: 16 },
    aboutSub: { fontFamily: 'Inter-Regular', color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 2 },
    aboutVersion: { fontFamily: 'Inter-SemiBold', color: 'rgba(255,255,255,0.3)', fontSize: 12, alignSelf: 'flex-start' },
});
