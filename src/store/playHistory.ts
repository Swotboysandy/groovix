// ListeningStats: a private, on-device log of what was
// played and for how long, summarised into Replay periods.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Track } from '../types';
import { createSerialTaskQueue } from '../services/asyncTools';

const KEY = 'groovix_play_history_v1';
/** Enough for years of listening while staying a single small JSON blob. */
const MAX_ENTRIES = 20000;
/** Groovix counts a play once 30 seconds have actually been heard. */
export const PLAY_THRESHOLD_MS = 30_000;

export type PlayEntry = {
    id: number;
    title: string;
    artist: string;
    album?: string;
    albumId?: number;
    artistId?: number;
    cover?: string;
    /** Epoch ms when listening began. */
    at: number;
    /** Milliseconds actually heard. */
    ms: number;
    play: boolean;
};

export type ReplayPeriod = 'THIS_WEEK' | 'THIS_MONTH' | 'THIS_YEAR' | 'ALL_TIME';

export type RankedEntry = { key: string; title: string; subtitle?: string; cover?: string; id?: number; ms: number; plays: number };

export type ReplaySummary = {
    period: ReplayPeriod;
    label: string;
    totalMs: number;
    totalPlays: number;
    songs: (RankedEntry & { track: Track })[];
    artists: RankedEntry[];
    albums: RankedEntry[];
    hourOfDay: number[];
    peakHour: number | null;
    busiestDay: string | null;
    busiestDayMs: number;
    distinctSongs: number;
    distinctArtists: number;
    distinctAlbums: number;
    since: string | null;
};

const serialize = createSerialTaskQueue();

async function readAll(): Promise<PlayEntry[]> {
    try {
        const raw = await AsyncStorage.getItem(KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

/** Records one listening session; anything under a second is noise. */
export function recordListening(track: Track, startedAt: number, listenedMs: number): Promise<void> {
    if (listenedMs < 1000 || !track?.id) return Promise.resolve();
    return serialize(async () => {
        const entries = await readAll();
        entries.push({
            id: track.id,
            title: track.title,
            artist: track.artist?.name || '',
            album: track.album?.title,
            albumId: track.album?.id,
            artistId: track.artist?.id,
            cover: track.album?.cover,
            at: startedAt,
            ms: Math.round(listenedMs),
            play: listenedMs >= PLAY_THRESHOLD_MS,
        });
        await AsyncStorage.setItem(KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
    });
}

function periodStart(period: ReplayPeriod, now = new Date()): number {
    switch (period) {
        case 'THIS_WEEK': {
            const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const weekday = (start.getDay() + 6) % 7; // Monday first
            start.setDate(start.getDate() - weekday);
            return start.getTime();
        }
        case 'THIS_MONTH': return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        case 'THIS_YEAR': return new Date(now.getFullYear(), 0, 1).getTime();
        default: return 0;
    }
}

export function periodLabel(period: ReplayPeriod, now = new Date()): string {
    switch (period) {
        case 'THIS_WEEK': return 'This week';
        case 'THIS_MONTH': return now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
        case 'THIS_YEAR': return String(now.getFullYear());
        default: return 'All time';
    }
}

function rank<T extends RankedEntry>(map: Map<string, T>): T[] {
    return [...map.values()].sort((a, b) => b.ms - a.ms || b.plays - a.plays);
}

export async function replaySummary(period: ReplayPeriod): Promise<ReplaySummary> {
    const all = await readAll();
    const from = periodStart(period);
    const entries = all.filter(entry => entry.at >= from);
    const songs = new Map<string, RankedEntry & { track: Track }>();
    const artists = new Map<string, RankedEntry>();
    const albums = new Map<string, RankedEntry>();
    const hourOfDay = new Array(24).fill(0);
    const days = new Map<string, number>();
    let totalMs = 0;
    let totalPlays = 0;

    for (const entry of entries) {
        const plays = entry.play ? 1 : 0;
        totalMs += entry.ms;
        totalPlays += plays;
        const songKey = String(entry.id);
        const song = songs.get(songKey) ?? {
            key: songKey, title: entry.title, subtitle: entry.artist, cover: entry.cover, id: entry.id, ms: 0, plays: 0,
            track: { id: entry.id, title: entry.title, duration: 0, artist: { id: entry.artistId ?? 0, name: entry.artist }, album: { id: entry.albumId ?? 0, title: entry.album ?? '', cover: entry.cover ?? '' } } as Track,
        };
        song.ms += entry.ms; song.plays += plays;
        songs.set(songKey, song);
        if (entry.artist) {
            const artist = artists.get(entry.artist) ?? { key: entry.artist, title: entry.artist, cover: entry.cover, id: entry.artistId, ms: 0, plays: 0 };
            artist.ms += entry.ms; artist.plays += plays;
            artists.set(entry.artist, artist);
        }
        if (entry.album) {
            const albumKey = `${entry.album}|${entry.artist}`;
            const album = albums.get(albumKey) ?? { key: albumKey, title: entry.album, subtitle: entry.artist, cover: entry.cover, id: entry.albumId, ms: 0, plays: 0 };
            album.ms += entry.ms; album.plays += plays;
            albums.set(albumKey, album);
        }
        const at = new Date(entry.at);
        hourOfDay[at.getHours()] += entry.ms;
        const day = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
        days.set(day, (days.get(day) ?? 0) + entry.ms);
    }

    const busiest = [...days.entries()].sort((a, b) => b[1] - a[1])[0];
    const peak = hourOfDay.reduce((best, ms, hour) => (ms > (best === null ? 0 : hourOfDay[best]) ? hour : best), null as number | null);
    const first = all[0];
    const since = first ? `${String(new Date(first.at).getMonth() + 1).padStart(2, '0')}/${String(new Date(first.at).getFullYear() % 100).padStart(2, '0')}` : null;
    const rankedSongs = rank(songs);
    const rankedArtists = rank(artists);
    const rankedAlbums = rank(albums);

    return {
        period,
        label: periodLabel(period),
        totalMs,
        totalPlays,
        songs: rankedSongs,
        artists: rankedArtists,
        albums: rankedAlbums,
        hourOfDay,
        peakHour: peak,
        busiestDay: busiest?.[0] ?? null,
        busiestDayMs: busiest?.[1] ?? 0,
        distinctSongs: rankedSongs.length,
        distinctArtists: rankedArtists.length,
        distinctAlbums: rankedAlbums.length,
        since,
    };
}
