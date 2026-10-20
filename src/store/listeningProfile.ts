import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Track } from '../types';
import { createSerialTaskQueue } from '../services/asyncTools';

const KEY = 'groovix_listening_profile_v1';
const serializeWrite = createSerialTaskQueue();

export interface ListeningProfile {
    artistPlays: Record<string, number>;
    trackPlays: Record<string, number>;
    recentTracks: Track[];
    likedTrackIds: number[];
    likedTracks: Track[];
}

const emptyProfile = (): ListeningProfile => ({
    artistPlays: {},
    trackPlays: {},
    recentTracks: [],
    likedTrackIds: [],
    likedTracks: [],
});

export async function getListeningProfile(): Promise<ListeningProfile> {
    try {
        const raw = await AsyncStorage.getItem(KEY);
        if (!raw) return emptyProfile();
        const stored = JSON.parse(raw) as Partial<ListeningProfile>;
        return {
            artistPlays: stored.artistPlays ?? {},
            trackPlays: stored.trackPlays ?? {},
            recentTracks: stored.recentTracks ?? [],
            likedTrackIds: stored.likedTrackIds ?? [],
            likedTracks: stored.likedTracks ?? [],
        };
    } catch {
        return emptyProfile();
    }
}

export async function recordPlayedTrack(track: Track): Promise<void> {
    return serializeWrite(async () => {
    const profile = await getListeningProfile();
    const artist = track.artist?.name?.trim();
    const trackKey = String(track.id);
    if (artist) profile.artistPlays[artist] = (profile.artistPlays[artist] ?? 0) + 1;
    profile.trackPlays[trackKey] = (profile.trackPlays[trackKey] ?? 0) + 1;
    profile.recentTracks = [track, ...profile.recentTracks.filter(item => item.id !== track.id)].slice(0, 30);
    await AsyncStorage.setItem(KEY, JSON.stringify(profile));
    });
}

export async function toggleLikedTrack(track: Track): Promise<boolean> {
    return serializeWrite(async () => {
    const profile = await getListeningProfile();
    const liked = profile.likedTrackIds.includes(track.id);
    if (liked) {
        profile.likedTrackIds = profile.likedTrackIds.filter(id => id !== track.id);
        profile.likedTracks = profile.likedTracks.filter(item => item.id !== track.id);
    } else {
        profile.likedTrackIds = [track.id, ...profile.likedTrackIds];
        profile.likedTracks = [track, ...profile.likedTracks.filter(item => item.id !== track.id)];
        const artist = track.artist?.name?.trim();
        if (artist) profile.artistPlays[artist] = (profile.artistPlays[artist] ?? 0) + 3;
    }
    await AsyncStorage.setItem(KEY, JSON.stringify(profile));
    return !liked;
    });
}

export function topArtists(profile: ListeningProfile, limit = 4): string[] {
    return Object.entries(profile.artistPlays)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([artist]) => artist);
}
