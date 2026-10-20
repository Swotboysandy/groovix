// LrcLib — exact /get match, then best /search hit by duration.
import { LYRICS_AGENT, httpGet, parseJson, qs } from './http';
import { parseLrc } from './parsers';
import { Line, Query } from './types';

const BASE = 'https://lrclib.net/api';

const NOISE =
    /\((?:from|feat\.?|official|lyrical|video|audio|remix)[^)]*\)|\[[^\]]*]|\b(?:official (?:video|audio|music video)|lyrical|full song|4k video)\b/gi;

function clean(s: string): string {
    const out = s.replace(NOISE, ' ').split(' | ')[0].replace(/\s+/g, ' ').trim();
    return out || s;
}

const get = (url: string, signal?: AbortSignal) =>
    httpGet(url, { headers: { 'User-Agent': LYRICS_AGENT }, signal });

export async function lrcLibLyrics(q: Query): Promise<Line[] | null> {
    const title = clean(q.title);
    const artist = clean(q.artist);
    const seconds = Math.floor(q.durationMs / 1000);

    let synced: string | null = null;
    const exact = parseJson(
        await get(qs(`${BASE}/get`, { track_name: title, artist_name: artist, duration: seconds }), q.signal),
    );
    if (exact && typeof exact.syncedLyrics === 'string' && exact.syncedLyrics) synced = exact.syncedLyrics;
    if (!synced) {
        const hits = parseJson(await get(qs(`${BASE}/search`, { track_name: title, artist_name: artist }), q.signal));
        if (Array.isArray(hits)) {
            let bestDist = Infinity;
            for (const h of hits) {
                if (typeof h?.syncedLyrics !== 'string' || !h.syncedLyrics.trim()) continue;
                const d = Math.abs((typeof h.duration === 'number' ? h.duration : 0) - seconds);
                if (d < bestDist) {
                    bestDist = d;
                    synced = h.syncedLyrics;
                }
            }
        }
    }
    if (!synced) return null;
    const lines = parseLrc(synced);
    return lines.length ? lines : null;
}
