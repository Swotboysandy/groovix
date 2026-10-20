// BetterLyrics (plus the Portato / QQ endpoint).
import { lyricsGet, qs } from './http';
import { parseProviderLyrics } from './parsers';
import { Line, Query } from './types';

const BASE = 'https://lyrics-api.boidu.dev/getLyrics';
const PORTATO = 'https://lyrics-api.boidu.dev/qq/getLyrics';

async function fetchFrom(endpoint: string, q: Query): Promise<Line[] | null> {
    const seconds = Math.floor(q.durationMs / 1000);
    const url = qs(endpoint, {
        s: q.title,
        a: q.artist,
        d: seconds > 0 ? seconds : undefined,
        al: q.album?.trim() || undefined,
    });
    const body = await lyricsGet(url, q.signal);
    return body ? parseProviderLyrics(body) : null;
}

export const betterLyrics = (q: Query) => fetchFrom(BASE, q);
export const betterLyricsPortato = (q: Query) => fetchFrom(PORTATO, q);
