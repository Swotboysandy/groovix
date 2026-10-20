// BiniLyrics — Apple TTML matched by recording; reports the ISRC.
import { lyricsGet, parseJson, qs } from './http';
import { parseTtml } from './parsers';
import { Line, Query } from './types';
import type { DocGet } from './lrcRed';

const BASE = 'https://lyrics-api.binimum.org/';

export type BiniHit = {
    track_name?: string;
    artist_name?: string;
    album_name?: string;
    duration?: number;
    isrc?: string;
    timing_type?: string;
    lyricsUrl?: string;
};

export type BiniMatch = { isrc?: string; lines: Line[] };

/** Which recording this is, without fetching its words. */
export async function biniIdentify(q: Query): Promise<BiniHit | null> {
    const params: Record<string, string | undefined> = {};
    if (q.isrc && q.isrc.trim()) {
        params.isrc = q.isrc;
    } else {
        params.track = q.title;
        params.artist = q.artist;
        if (q.album && q.album.trim()) params.album = q.album;
        const seconds = Math.floor(q.durationMs / 1000);
        if (seconds > 0) params.duration = String(seconds);
    }
    const body = await lyricsGet(qs(BASE, params), q.signal);
    const results = parseJson(body)?.results;
    return Array.isArray(results) && results.length ? results[0] : null;
}

export async function biniLyricsFor(hit: BiniHit, get: DocGet): Promise<BiniMatch | null> {
    const doc = hit.lyricsUrl?.trim();
    if (!doc) return null;
    const ttml = await get(doc);
    if (!ttml) return null;
    const lines = parseTtml(ttml);
    if (!lines.length) return null;
    return { isrc: hit.isrc?.trim() || undefined, lines };
}

export async function biniLyrics(q: Query, get: DocGet): Promise<BiniMatch | null> {
    const hit = await biniIdentify(q);
    return hit ? biniLyricsFor(hit, get) : null;
}
