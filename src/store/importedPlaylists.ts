import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Track } from '../types';
import { createSerialTaskQueue } from '../services/asyncTools';

const KEY = 'groovix_imported_playlists_v1';
const serializeWrite = createSerialTaskQueue();

export type PlaylistPlatform = 'spotify' | 'youtube' | 'apple' | 'tidal';

export interface ImportedPlaylistTrack {
    title: string;
    artist: string;
    duration?: number;
    resolved?: Track;
}

export interface ImportedPlaylist {
    id: string;
    title: string;
    cover?: string;
    sourceUrl: string;
    platform: PlaylistPlatform;
    tracks: ImportedPlaylistTrack[];
    sourceTrackCount: number;
    importedAt: string;
}

export async function getImportedPlaylists(): Promise<ImportedPlaylist[]> {
    try {
        const raw = await AsyncStorage.getItem(KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        // Migrate the first development build, which stored resolved Track objects directly.
        return parsed.map((playlist: any) => ({
            ...playlist,
            tracks: Array.isArray(playlist.tracks) ? playlist.tracks.map((item: any) => item?.artist && typeof item.artist === 'object'
                ? { title: item.title, artist: item.artist.name || '', duration: item.duration, resolved: item }
                : item) : [],
        }));
    } catch {
        return [];
    }
}

export async function saveImportedPlaylist(playlist: ImportedPlaylist): Promise<void> {
    return serializeWrite(async () => {
    const current = await getImportedPlaylists();
    const next = [playlist, ...current.filter(item => item.sourceUrl !== playlist.sourceUrl)];
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
    });
}

export async function deleteImportedPlaylist(id: string): Promise<void> {
    return serializeWrite(async () => {
    const current = await getImportedPlaylists();
    await AsyncStorage.setItem(KEY, JSON.stringify(current.filter(item => item.id !== id)));
    });
}

export async function renameImportedPlaylist(id: string, title: string): Promise<ImportedPlaylist | null> {
    const cleanTitle = title.trim().replace(/\s+/g, ' ');
    if (!cleanTitle) return null;
    return serializeWrite(async () => {
    const current = await getImportedPlaylists();
    let renamed: ImportedPlaylist | null = null;
    const next = current.map(playlist => {
        if (playlist.id !== id) return playlist;
        renamed = { ...playlist, title: cleanTitle };
        return renamed;
    });
    if (!renamed) return null;
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
    return renamed;
    });
}
