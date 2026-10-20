// Unison — community-submitted lyrics.
import { lyricsGet, parseJson, qs } from './http';
import { parseEnhancedLrc, parseLrc, parseTtml, plainLines } from './parsers';
import { Line, Query } from './types';

const BASE = 'https://unison.boidu.dev/lyrics';

export async function unisonLyrics(q: Query): Promise<Line[] | null> {
    const seconds = Math.floor(q.durationMs / 1000);
    const body = await lyricsGet(
        qs(BASE, {
            song: q.title,
            artist: q.artist,
            album: q.album?.trim() || undefined,
            duration: seconds > 0 ? seconds : undefined,
        }),
        q.signal,
    );
    const res = parseJson(body);
    if (!res || res.success !== true || !res.data) return null;
    const data = res.data;
    const text: string | undefined = typeof data.lyrics === 'string' && data.lyrics.trim() ? data.lyrics : undefined;
    if (!text) return null;
    let lines: Line[];
    if (String(data.format || '').toLowerCase() === 'ttml') lines = parseTtml(text);
    else if (String(data.syncType || '').toLowerCase() === 'plain') lines = plainLines(text);
    else {
        lines = parseEnhancedLrc(text);
        if (!lines.length) lines = parseLrc(text);
    }
    return lines.length ? lines : null;
}
