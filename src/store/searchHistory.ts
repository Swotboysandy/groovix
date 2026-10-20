// "Recent searches": songs played from Search, newest first.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Track } from '../types';

const KEY = 'groovix_search_history_v1';
const LIMIT = 30;

export async function getSearchHistory(): Promise<Track[]> {
    try {
        const raw = await AsyncStorage.getItem(KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

async function write(tracks: Track[]): Promise<Track[]> {
    await AsyncStorage.setItem(KEY, JSON.stringify(tracks));
    return tracks;
}

export async function addSearchHistory(track: Track): Promise<Track[]> {
    const current = await getSearchHistory();
    return write([track, ...current.filter(item => item.id !== track.id)].slice(0, LIMIT));
}

export async function removeSearchHistory(id: number): Promise<Track[]> {
    return write((await getSearchHistory()).filter(item => item.id !== id));
}

export async function clearSearchHistory(): Promise<Track[]> {
    return write([]);
}
